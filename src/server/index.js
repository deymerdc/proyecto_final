import express from 'express';
import logger from 'morgan';
import dotenv from 'dotenv';
import { createClient } from '@libsql/client';
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import session from 'express-session';
import bodyParser from 'body-parser';
import bcrypt from 'bcryptjs';
import proyectoRoutes from '../routes/proyecto.routes.js';
import SlotManager from './slotManager.js';

dotenv.config();
const port = process.env.PORT ?? 3000;
const app = express();
const server = createServer(app);
const io = new Server(server, {
    connectionStateRecovery: {}
});

const db = createClient({
    url: "libsql://epic-scarlet-witch-kyor.turso.io",
    authToken: process.env.DB_TOKEN
});

// Ensure the tables exist
await db.execute(`
    CREATE TABLE IF NOT EXISTS messages(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT,
        username TEXT,
        room_id INTEGER,
        FOREIGN KEY (room_id) REFERENCES rooms(id)
    )
`);

await db.execute(`
    CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
    )
`);

await db.execute(`
    CREATE TABLE IF NOT EXISTS rooms(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE
    )
`);

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true
}));

// Routes
app.use(proyectoRoutes);
app.use(express.static('src/public'));

// Route to register a new user
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).send('Username and password are required');
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        await db.execute({
            sql: `INSERT INTO users (username, password) VALUES (:username, :hashedPassword)`,
            args: { username: String(username), hashedPassword: String(hashedPassword) }
        });
        res.status(201).send('User registered successfully');
    } catch (e) {
        console.error(e);
        res.status(500).send('Error registering user');
    }
});

// Route to authenticate a user
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).send('Username and password are required');
    }

    try {
        const result = await db.execute({
            sql: `SELECT * FROM users WHERE username = :username`,
            args: { username: String(username) }
        });

        const user = result.rows[0];
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.user = user;
            res.status(200).send('Login successful');
        } else {
            res.status(401).send('Invalid credentials');
        }
    } catch (e) {
        console.error(e);
        res.status(500).send('Error logging in');
    }
});

// Route to create a new room
app.post('/create-room', async (req, res) => {
    const { roomName } = req.body;
    if (!roomName) {
        return res.status(400).send('Room name is required');
    }

    try {
        // Check if the room already exists
        const result = await db.execute({
            sql: `SELECT * FROM rooms WHERE name = :roomName`,
            args: { roomName: String(roomName) }
        });

        if (result.rows.length > 0) {
            res.status(409).send('Room already exists');
        } else {
            await db.execute({
                sql: `INSERT INTO rooms (name) VALUES (:roomName)`,
                args: { roomName: String(roomName) }
            });
            res.status(201).send('Room created successfully');
        }
    } catch (e) {
        console.error(e);
        res.status(500).send('Error creating room');
    }
});

// Route to join a room
app.post('/join-room', async (req, res) => {
    const { roomName } = req.body;
    if (!roomName) {
        return res.status(400).send('Room name is required');
    }

    try {
        const result = await db.execute({
            sql: `SELECT * FROM rooms WHERE name = :roomName`,
            args: { roomName: String(roomName) }
        });

        if (result.rows.length > 0) {
            res.status(200).send('Room joined successfully');
        } else {
            res.status(404).send('Room not found');
        }
    } catch (e) {
        console.error(e);
        res.status(500).send('Error joining room');
    }
});

// Route to get the list of rooms
app.get('/rooms', async (req, res) => {
    try {
        const result = await db.execute({
            sql: `SELECT name FROM rooms`,
            args: {}
        });

        res.status(200).json(result.rows);
    } catch (e) {
        console.error('Error fetching rooms:', e);
        res.status(500).send('Error fetching rooms');
    }
});

// Slot Manager
const slotManager = new SlotManager(4);

// WebSocket connection for chat and video streaming
io.on('connection', (socket) => {
    console.log('a user connected');

    socket.on('disconnect', () => {
        console.log('user disconnected');
        const username = socket.username;
        if (username) {
            const slotIndex = slotManager.releaseSlot(username);
            if (slotIndex !== -1) {
                io.to(socket.roomName).emit('release slot', { slotIndex, username });
            }
        }
    });

    socket.on('join room', async ({ roomName, username }) => {
        if (!roomName || !username) {
            return socket.emit('error', { message: 'Room name and username are required' });
        }

        try {
            const result = await db.execute({
                sql: `SELECT * FROM rooms WHERE name = :roomName`,
                args: { roomName: String(roomName) }
            });

            if (result.rows.length > 0) {
                const roomId = result.rows[0].id;
                socket.join(roomName);
                socket.roomName = roomName;
                socket.roomId = roomId;
                socket.username = username;
                io.to(roomName).emit('user-connected', socket.id);
                io.to(roomName).emit('user joined', { username });

                // Fetch previous messages
                const messages = await db.execute({
                    sql: `SELECT content, username FROM messages WHERE room_id = :roomId ORDER BY id`,
                    args: { roomId }
                });

                messages.rows.forEach(message => {
                    socket.emit('chat message', { msg: message.content, username: message.username });
                });
            } else {
                socket.emit('error', { message: 'Room not found' });
            }
        } catch (e) {
            console.error(e);
            socket.emit('error', { message: 'Error joining room' });
        }
    });

    socket.on('start stream', ({ username }) => {
        if (!username) {
            return;
        }

        const slotIndex = slotManager.assignSlot(username);
        if (slotIndex !== -1) {
            socket.username = username;
            socket.slotIndex = slotIndex;
            io.to(socket.roomName).emit('assign slot', { username, slotIndex });
            socket.emit('slot assigned', { slotIndex }); // Asegura que el cliente sepa su slot asignado
        } else {
            socket.emit('error', { message: 'No available slot' });
        }
    });

    socket.on('stop stream', ({ username }) => {
        if (!username) {
            return;
        }

        const slotIndex = slotManager.releaseSlot(username);
        if (slotIndex !== -1) {
            io.to(socket.roomName).emit('release slot', { slotIndex, username });
        }
    });

    socket.on('stream', ({ username, image, slotIndex }) => {
        if (!username || !image || slotIndex === undefined || slotIndex === null) {
            return;
        }

        io.to(socket.roomName).emit('stream', { username, image, slotIndex });
    });

    socket.on('chat message', async ({ msg, roomName, username }) => {
        if (!msg || !roomName || !username) {
            return;
        }

        try {
            await db.execute({
                sql: `INSERT INTO messages (content, username, room_id) VALUES (:msg, :username, (SELECT id FROM rooms WHERE name = :roomName))`,
                args: { msg: String(msg), username: String(username), roomName: String(roomName) }
            });
            io.to(roomName).emit('chat message', { msg, username });
        } catch (e) {
            console.error(e);
        }
    });
});

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

export default server;
