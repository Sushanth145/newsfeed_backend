require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const redis = require("redis");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = express();
const port = 5000;
app.use(cors());
app.use(bodyParser.json());
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
const redisClient = redis.createClient({
    url: "redis://default:c75207c8f0684fc58ebf8eeb310ea66d@gusc1-sharp-osprey-31084.upstash.io:31084",
    socket: {
        tls: true
    }
});
redisClient.on("connect", () => console.log("✅ Connected to Upstash Redis"));
redisClient.on("error", (err) => console.error("❌ Redis Error:", err));
(async () => {
    try {
        await redisClient.connect();
    } catch (error) {
        console.error("❌ Redis connection failed:", error);
    }
})();
app.get("/", (req, res) => res.send("News Feed API is running!"));
app.post("/users", async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: "All fields are required" });
    }
    try {
        const result = await pool.query(
            "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING *",
            [username, email, password]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post("/posts", async (req, res) => {
    const { userId, content, mediaUrl } = req.body;
    try {
        const result = await pool.query(
            "INSERT INTO posts (user_id, content, media_url) VALUES ($1, $2, $3) RETURNING *",
            [userId, content, mediaUrl]
        );
        const followers = await pool.query(
            "SELECT follower_id FROM followers WHERE followee_id = $1",
            [userId]
        );
        followers.rows.forEach(({ follower_id }) => {
            redisClient.del(`feed:${follower_id}`);
        });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get("/feed/:userId", async (req, res) => {
    const { userId } = req.params;
    const cachedFeed = await redisClient.get(`feed:${userId}`);
    if (cachedFeed) {
        return res.json(JSON.parse(cachedFeed));
    }
    try {
        const result = await pool.query(
            `SELECT posts.*, users.username 
             FROM posts 
             JOIN users ON posts.user_id = users.id 
             WHERE user_id IN (SELECT followee_id FROM followers WHERE follower_id = $1)
             ORDER BY created_at DESC 
             LIMIT 50`, 
            [userId]
        );

        redisClient.setEx(`feed:${userId}`, 3600, JSON.stringify(result.rows));

        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post("/follow", async (req, res) => {
    const { followerId, followeeId } = req.body;
    try {
        await pool.query(
            "INSERT INTO followers (follower_id, followee_id) VALUES ($1, $2)",
            [followerId, followeeId]
        );
        redisClient.del(`feed:${followerId}`); // Clear cache
        res.json({ message: "Followed successfully!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post("/like", async (req, res) => {
    const { userId, postId } = req.body;
    try {
        await pool.query(
            "INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [userId, postId]
        );
        res.json({ message: "Post liked!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.listen(port, () => console.log(`Server running on port ${port}`));