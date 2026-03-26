const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the current directory
app.use(express.static('./'));

// Game State
const players = {};
const builtObjects = {};
let objectIdCounter = 0;

// Pre-fill maps with some default structures
const GRID_SIZE = 5;

function addPrebuilt(type, x, y, z, rotation, mapName) {
    const objId = `prebuilt_${objectIdCounter++}`;
    builtObjects[objId] = {
        id: objId,
        type: type,
        x: x, y: y, z: z,
        rotation: rotation,
        health: 500, // Pre-built objects have more health
        ownerId: 'server',
        map: mapName
    };
}

// Map: Classic (1vs1 Arena)
// Two simple bases facing each other
// Base 1
addPrebuilt('floor', 0, 5, -20, 0, 'classic');
addPrebuilt('ramp', 0, 2.5, -15, 0, 'classic');
addPrebuilt('wall', 0, 2.5, -20, 0, 'classic');
// Base 2
addPrebuilt('floor', 0, 5, 20, 0, 'classic');
addPrebuilt('ramp', 0, 2.5, 15, Math.PI, 'classic');
addPrebuilt('wall', 0, 2.5, 20, 0, 'classic');

// Map: Island (A central tower structure)
addPrebuilt('floor', 0, 5, 0, 0, 'island');
addPrebuilt('wall', 2.5, 2.5, 0, Math.PI/2, 'island');
addPrebuilt('wall', -2.5, 2.5, 0, Math.PI/2, 'island');
addPrebuilt('ramp', 0, 7.5, 0, 0, 'island'); // Ramp on top of floor

// Map: City (Buildings with cover)
// Building 1 (Left)
addPrebuilt('floor', -15, 5, -15, 0, 'city');
addPrebuilt('wall', -15, 2.5, -17.5, 0, 'city');
addPrebuilt('wall', -12.5, 2.5, -15, Math.PI/2, 'city');
addPrebuilt('wall', -17.5, 2.5, -15, Math.PI/2, 'city');
addPrebuilt('ramp', -15, 2.5, -12.5, Math.PI, 'city');

// Building 2 (Right)
addPrebuilt('floor', 15, 5, 15, 0, 'city');
addPrebuilt('wall', 15, 2.5, 17.5, 0, 'city');
addPrebuilt('wall', 12.5, 2.5, 15, Math.PI/2, 'city');
addPrebuilt('wall', 17.5, 2.5, 15, Math.PI/2, 'city');
addPrebuilt('ramp', 15, 2.5, 12.5, Math.PI, 'city');

// Scattered Cover (Trees/Bushes using custom structure types or repurposed walls)
// We'll use special types 'tree' and 'bush' which the client will render specifically.
addPrebuilt('tree', -5, 0, 10, 0, 'city');
addPrebuilt('tree', 10, 0, -5, 0, 'city');
addPrebuilt('tree', 20, 0, 0, 0, 'city');
addPrebuilt('tree', -20, 0, -20, 0, 'city');

addPrebuilt('bush', -10, 0, 5, 0, 'city');
addPrebuilt('bush', 5, 0, -10, 0, 'city');
addPrebuilt('bush', 15, 0, 5, 0, 'city');
addPrebuilt('bush', -5, 0, -15, 0, 'city');

// Map: Platform (Scattered cover)
addPrebuilt('wall', 5, 2.5, 5, 0, 'platform');
addPrebuilt('wall', -5, 2.5, -5, Math.PI/2, 'platform');
addPrebuilt('ramp', 10, 2.5, 0, Math.PI/2, 'platform');

io.on('connection', (socket) => {
    console.log(`[+] Player connected: ${socket.id}`);

    // Create a new player state
    players[socket.id] = {
        id: socket.id,
        x: 0, y: 5, z: 0, // default spawn
        rotation: 0,
        health: 100,
        map: 'classic' // default map
    };

    // Send current game state to the new player
    socket.emit('initGame', {
        players: players,
        builtObjects: builtObjects,
        socketId: socket.id
    });

    // Broadcast new player to everyone else
    socket.broadcast.emit('playerJoined', players[socket.id]);

    // Update player map selection
    socket.on('joinMap', (mapName) => {
        players[socket.id].map = mapName;
        // Broadcast that they joined a specific map
        io.emit('playerMapUpdate', { id: socket.id, map: mapName });
    });

    // Handle Movement
    socket.on('playerMove', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            players[socket.id].rotation = data.rotation;
        }
    });

    // Handle Shooting/Damage
    socket.on('playerHit', (data) => {
        const targetId = data.targetId;
        const damage = data.damage || 35; // Weapon damage

        if (players[targetId]) {
            players[targetId].health -= damage;
            console.log(`[*] ${socket.id} hit ${targetId} (-${damage} HP). Remaining: ${players[targetId].health}`);

            if (players[targetId].health <= 0) {
                // Handle Death
                io.emit('playerDied', { id: targetId, killerId: socket.id });
                players[targetId].health = 100; // Auto-respawn health

                // Teleport to spawn (simple fix for now)
                players[targetId].x = 0;
                players[targetId].y = 5;
                players[targetId].z = 0;

                io.emit('playerRespawn', players[targetId]);
            } else {
                // Broadcast health update
                io.emit('playerHealthUpdate', { id: targetId, health: players[targetId].health });
            }
        }
    });

    // Handle Building
    socket.on('buildObject', (data) => {
        const objId = `obj_${objectIdCounter++}`;
        const newObj = {
            id: objId,
            type: data.type, // 'wall', 'floor', 'ramp'
            x: data.x,
            y: data.y,
            z: data.z,
            rotation: data.rotation,
            health: 100,
            ownerId: socket.id,
            map: players[socket.id].map
        };

        builtObjects[objId] = newObj;

        // Broadcast to everyone
        io.emit('objectBuilt', newObj);
    });

    // Handle Destroying Buildings
    socket.on('hitObject', (data) => {
        const objId = data.objId;
        if (builtObjects[objId]) {
            builtObjects[objId].health -= 35;

            if (builtObjects[objId].health <= 0) {
                delete builtObjects[objId];
                io.emit('objectDestroyed', { objId: objId });
            } else {
                io.emit('objectHealthUpdate', { objId: objId, health: builtObjects[objId].health });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`[-] Player disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

// Broadcast player states 20 times a second
setInterval(() => {
    io.emit('gameStateUpdate', players);
}, 1000 / 20);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
