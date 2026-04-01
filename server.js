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
const weaponSpawns = {};
const bots = {}; // AI Zombies
const lobbies = {
    'public': {
        id: 'public',
        mode: 'ffa', // ffa, br, zonewars, pve
        state: 'playing', // waiting, playing, ended
        maxHealth: 100,
        stormRadius: 1000,
        stormCenter: { x: 0, z: 0 },
        stormPhase: 0,
        nextStormUpdate: 0,
        playersAlive: 0,
        currentWave: 0,
        botsAlive: 0
    }
};
let objectIdCounter = 0;
let weaponIdCounter = 0;
let botIdCounter = 0;

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
        map: mapName,
        lobby: 'public' // Pre-built objects exist in the public lobby by default
    };
}

function addWeaponSpawn(weaponType, x, y, z, mapName) {
    const spawnId = `weapon_${weaponIdCounter++}`;
    weaponSpawns[spawnId] = {
        id: spawnId,
        weaponType: weaponType,
        x: x, y: y, z: z,
        map: mapName,
        lobby: 'public',
        active: true,
        respawnTime: 0
    };
}

// Map: Classic (1vs1 Arena)
// Two simple bases facing each other
// Base 1
addPrebuilt('floor', 0, 5, -20, 0, 'classic');
addPrebuilt('ramp', 0, 2.5, -15, 0, 'classic');
addPrebuilt('wall', 0, 2.5, -20, 0, 'classic');
addWeaponSpawn('ar', 0, 6, -20, 'classic');
addWeaponSpawn('shotgun', 5, 0.5, 0, 'classic');

// Base 2
addPrebuilt('floor', 0, 5, 20, 0, 'classic');
addPrebuilt('ramp', 0, 2.5, 15, Math.PI, 'classic');
addPrebuilt('wall', 0, 2.5, 20, 0, 'classic');
addWeaponSpawn('ar', 0, 6, 20, 'classic');
addWeaponSpawn('sniper', -5, 0.5, 0, 'classic');

// Map: Island (A central tower structure)
addPrebuilt('floor', 0, 5, 0, 0, 'island');
addPrebuilt('wall', 2.5, 2.5, 0, Math.PI/2, 'island');
addPrebuilt('wall', -2.5, 2.5, 0, Math.PI/2, 'island');
addPrebuilt('ramp', 0, 7.5, 0, 0, 'island'); // Ramp on top of floor
addWeaponSpawn('sniper', 0, 8, 0, 'island'); // Top of tower
addWeaponSpawn('smg', 10, 0.5, 10, 'island');
addWeaponSpawn('ar', -10, 0.5, -10, 'island');

// Map: City (Buildings with cover)
// Building 1 (Left)
addPrebuilt('floor', -15, 5, -15, 0, 'city');
addPrebuilt('wall', -15, 2.5, -17.5, 0, 'city');
addPrebuilt('wall', -12.5, 2.5, -15, Math.PI/2, 'city');
addPrebuilt('wall', -17.5, 2.5, -15, Math.PI/2, 'city');
addPrebuilt('ramp', -15, 2.5, -12.5, Math.PI, 'city');
addWeaponSpawn('sniper', -15, 6, -15, 'city');

// Building 2 (Right)
addPrebuilt('floor', 15, 5, 15, 0, 'city');
addPrebuilt('wall', 15, 2.5, 17.5, 0, 'city');
addPrebuilt('wall', 12.5, 2.5, 15, Math.PI/2, 'city');
addPrebuilt('wall', 17.5, 2.5, 15, Math.PI/2, 'city');
addPrebuilt('ramp', 15, 2.5, 12.5, Math.PI, 'city');
addWeaponSpawn('ar', 15, 6, 15, 'city');

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
addWeaponSpawn('shotgun', 0, 0.5, 0, 'city');

// Map: Platform (Scattered cover)
addPrebuilt('wall', 5, 2.5, 5, 0, 'platform');
addPrebuilt('wall', -5, 2.5, -5, Math.PI/2, 'platform');
addPrebuilt('ramp', 10, 2.5, 0, Math.PI/2, 'platform');
addWeaponSpawn('sniper', 5, 5, 5, 'platform');
addWeaponSpawn('smg', -5, 5, -5, 'platform');

// Map: Desert (Ruins)
addPrebuilt('wall', -10, 2.5, 10, Math.PI/4, 'desert');
addPrebuilt('wall', -10, 7.5, 10, Math.PI/4, 'desert');
addPrebuilt('wall', 10, 2.5, -10, -Math.PI/4, 'desert');
addPrebuilt('ramp', -5, 2.5, 15, Math.PI, 'desert');
addPrebuilt('floor', -10, 10, 10, 0, 'desert');
addWeaponSpawn('shotgun', -10, 11, 10, 'desert');
addWeaponSpawn('ar', 10, 0.5, -10, 'desert');

// Map: Space (Floating platforms)
addPrebuilt('floor', 0, 15, 0, 0, 'space');
addPrebuilt('ramp', 0, 12.5, 5, 0, 'space');
addPrebuilt('floor', 15, 25, 15, 0, 'space');
addPrebuilt('ramp', 10, 22.5, 15, Math.PI/2, 'space');
addWeaponSpawn('ar', 0, 16, 0, 'space');
addWeaponSpawn('sniper', 15, 26, 15, 'space');

// Map: Lava (Safe platforms over lava)
addPrebuilt('floor', 0, 5, 0, 0, 'lava');
addPrebuilt('floor', 10, 10, 10, 0, 'lava');
addPrebuilt('ramp', 5, 7.5, 10, Math.PI/2, 'lava');
addPrebuilt('wall', 0, 7.5, -2.5, 0, 'lava');
addWeaponSpawn('smg', 0, 6, 0, 'lava');
addWeaponSpawn('ar', 10, 11, 10, 'lava');

// Map: Snow (Icy cover)
addPrebuilt('wall', 0, 2.5, 10, 0, 'snow');
addPrebuilt('ramp', 0, 2.5, 15, Math.PI, 'snow');
addPrebuilt('wall', 10, 2.5, -10, Math.PI/4, 'snow');
addPrebuilt('wall', -10, 2.5, -10, -Math.PI/4, 'snow');
addWeaponSpawn('shotgun', 0, 0.5, 15, 'snow');
addWeaponSpawn('sniper', 0, 0.5, -15, 'snow');

// Map: Forest (Natural cover via trees, represented as prebuilts)
for (let i = 0; i < 15; i++) {
    const rX = (Math.random() - 0.5) * 80;
    const rZ = (Math.random() - 0.5) * 80;
    // Don't spawn right at center (0,0) where players spawn
    if (Math.abs(rX) > 10 || Math.abs(rZ) > 10) {
        addPrebuilt('tree', rX, 0, rZ, Math.random() * Math.PI, 'forest');
    }
}
addWeaponSpawn('ar', 10, 0.5, 10, 'forest');
addWeaponSpawn('shotgun', -10, 0.5, -10, 'forest');
addWeaponSpawn('smg', -10, 0.5, 10, 'forest');

// Map: BR Island (Massive map with many spawns, cover, and high terrain)
for (let i = 0; i < 30; i++) {
    const rX = (Math.random() - 0.5) * 400;
    const rZ = (Math.random() - 0.5) * 400;
    addPrebuilt('tree', rX, 0, rZ, Math.random() * Math.PI, 'br_island');
}
for (let i = 0; i < 15; i++) {
    const rX = (Math.random() - 0.5) * 400;
    const rZ = (Math.random() - 0.5) * 400;
    addPrebuilt('rock', rX, 0, rZ, Math.random() * Math.PI, 'br_island');
}
// Scatter weapons globally
const wepTypes = ['ar', 'shotgun', 'smg', 'sniper', 'pistol'];
for (let i = 0; i < 40; i++) {
    const rX = (Math.random() - 0.5) * 400;
    const rZ = (Math.random() - 0.5) * 400;
    const rWep = wepTypes[Math.floor(Math.random() * wepTypes.length)];
    addWeaponSpawn(rWep, rX, 0.5, rZ, 'br_island');
}

// Map: Cyber City
addPrebuilt('floor', 0, 5, 0, 0, 'cyber_city');
addPrebuilt('wall', 0, 2.5, -5, 0, 'cyber_city');
addPrebuilt('wall', 0, 7.5, -5, 0, 'cyber_city');
addPrebuilt('wall', 0, 12.5, -5, 0, 'cyber_city');
addPrebuilt('ramp', 0, 2.5, 0, Math.PI, 'cyber_city');
addPrebuilt('floor', 0, 10, 0, 0, 'cyber_city');
addWeaponSpawn('sniper', 0, 11, 0, 'cyber_city');
addWeaponSpawn('smg', 5, 0.5, 5, 'cyber_city');

// Map: Moon Base
addPrebuilt('floor', 0, 5, 0, 0, 'moon_base');
addPrebuilt('wall', 2.5, 2.5, 0, Math.PI/2, 'moon_base');
addPrebuilt('wall', -2.5, 2.5, 0, Math.PI/2, 'moon_base');
addWeaponSpawn('ar', 0, 6, 0, 'moon_base');
addWeaponSpawn('pistol', 10, 0.5, 10, 'moon_base');

// Map: Canyon
addPrebuilt('ramp', 0, 2.5, -5, 0, 'canyon');
addPrebuilt('wall', 0, 7.5, -5, 0, 'canyon');
addPrebuilt('wall', 5, 7.5, 0, Math.PI/2, 'canyon');
addWeaponSpawn('sniper', 0, 10, 0, 'canyon');
addWeaponSpawn('ar', 5, 0.5, -5, 'canyon');

// Map: Neon City
addPrebuilt('floor', 0, 5, 0, 0, 'neon_city');
addPrebuilt('floor', 5, 5, 0, 0, 'neon_city');
addPrebuilt('floor', 0, 10, 0, 0, 'neon_city');
addPrebuilt('ramp', 0, 7.5, 5, Math.PI, 'neon_city');
addWeaponSpawn('smg', 0, 11, 0, 'neon_city');
addWeaponSpawn('shotgun', 5, 6, 0, 'neon_city');

io.on('connection', (socket) => {
    console.log(`[+] Player connected: ${socket.id}`);

    // Create a new player state
    players[socket.id] = {
        id: socket.id,
        x: 0, y: 5, z: 0, // default spawn
        rotation: 0,
        health: 100,
        map: 'classic', // default map
        kills: 0,
        deaths: 0,
        isSpectator: false,
        lobby: 'public' // default lobby
    };

    // Send current game state to the new player
    socket.emit('initGame', {
        players: players,
        builtObjects: builtObjects,
        weaponSpawns: weaponSpawns,
        socketId: socket.id
    });

    // Broadcast new player to everyone else
    socket.broadcast.emit('playerJoined', players[socket.id]);

    // Update player map selection
    socket.on('joinMap', (data) => {
        const mapName = typeof data === 'string' ? data : data.map;
        let isSpectator = typeof data === 'object' ? data.isSpectator : false;
        const lobbyId = typeof data === 'object' ? data.lobby : 'public';
        const gameMode = typeof data === 'object' ? data.gameMode : 'ffa';
        const maxHealth = typeof data === 'object' ? (data.maxHealth || 100) : 100;

        // Initialize Lobby if it doesn't exist
        if (!lobbies[lobbyId]) {
            lobbies[lobbyId] = {
                id: lobbyId,
                mode: gameMode,
                maxHealth: maxHealth,
                state: 'waiting',
                stormRadius: 1000,
                stormCenter: { x: 0, z: 0 },
                stormPhase: 0,
                nextStormUpdate: Date.now() + 10000, // 10s wait before game starts
                playersAlive: 0,
                currentWave: 0,
                botsAlive: 0
            };

            // Copy prebuilts
            const currentPrebuilts = Object.values(builtObjects).filter(o => o.lobby === 'public' && o.ownerId === 'server');
            for(let p of currentPrebuilts) {
                const objId = `prebuilt_${objectIdCounter++}`;
                builtObjects[objId] = { ...p, id: objId, lobby: lobbyId };
            }

            // Copy spawns
            const currentSpawns = Object.values(weaponSpawns).filter(s => s.lobby === 'public');
            for(let s of currentSpawns) {
                const spawnId = `weapon_${weaponIdCounter++}`;
                weaponSpawns[spawnId] = { ...s, id: spawnId, lobby: lobbyId };
            }
        }

        // If joining an active BR/ZoneWars, force spectate
        if (lobbies[lobbyId].state === 'playing' && (lobbies[lobbyId].mode === 'br' || lobbies[lobbyId].mode === 'zonewars')) {
            isSpectator = true;
        }

        // PVE: Drop in with full health
        if (lobbies[lobbyId].mode === 'pve') {
            isSpectator = false;
        }

        players[socket.id].map = mapName;
        players[socket.id].isSpectator = isSpectator;
        players[socket.id].lobby = lobbyId;
        players[socket.id].health = lobbies[lobbyId].maxHealth || 100;
        players[socket.id].playerSkin = typeof data === 'object' ? data.playerSkin : 'default';
        players[socket.id].weaponSkin = typeof data === 'object' ? data.weaponSkin : 'default';

        // Broadcast that they joined a specific map
        io.emit('playerMapUpdate', { id: socket.id, map: mapName, isSpectator, lobby: lobbyId, playerSkin: players[socket.id].playerSkin, weaponSkin: players[socket.id].weaponSkin });

        // Broadcast all players, let client filter. Otherwise other lobbies will get their boards wiped by this filtered list
        io.emit('leaderboardUpdate', Object.values(players));
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

        // PVE Bot Hit
        if (bots[targetId] && players[socket.id]) {
            bots[targetId].health -= damage;
            if (bots[targetId].health <= 0) {
                players[socket.id].kills += 1;
                io.emit('playerDied', { id: targetId, killerId: socket.id });
                delete bots[targetId];
                const lobbyId = players[socket.id].lobby;
                if (lobbies[lobbyId]) {
                    lobbies[lobbyId].botsAlive--;
                    io.emit('lobbyStateUpdate', lobbies[lobbyId]);
                }
                io.emit('botDestroyed', { id: targetId });
                io.emit('leaderboardUpdate', Object.values(players));
            }
            return;
        }

        if (players[targetId] && !players[targetId].isSpectator && players[socket.id] && !players[socket.id].isSpectator) {
            players[targetId].health -= damage;
            console.log(`[*] ${socket.id} hit ${targetId} (-${damage} HP). Remaining: ${players[targetId].health}`);

            if (players[targetId].health <= 0) {
                // Handle Death
                players[targetId].deaths += 1;
                if (players[socket.id]) players[socket.id].kills += 1;

                io.emit('playerDied', { id: targetId, killerId: socket.id });

                const lobbyId = players[targetId].lobby;
                const lobby = lobbies[lobbyId];

                // If BR or ZoneWars, they become a spectator
                if (lobby && (lobby.mode === 'br' || lobby.mode === 'zonewars') && lobby.state === 'playing') {
                    players[targetId].isSpectator = true;
                    io.emit('playerMapUpdate', { id: targetId, map: players[targetId].map, isSpectator: true, lobby: lobbyId, playerSkin: players[targetId].playerSkin, weaponSkin: players[targetId].weaponSkin });

                    // Decrease alive count
                    lobby.playersAlive--;
                    io.emit('lobbyStateUpdate', lobby);
                } else {
                    players[targetId].health = lobby ? lobby.maxHealth || 100 : 100; // Auto-respawn health

                    // Teleport to spawn (simple fix for now)
                    players[targetId].x = 0;
                    players[targetId].y = 5;
                    players[targetId].z = 0;

                    io.emit('playerRespawn', players[targetId]);
                }

                io.emit('leaderboardUpdate', Object.values(players));
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
            map: players[socket.id].map,
            lobby: players[socket.id].lobby
        };

        builtObjects[objId] = newObj;

        // Broadcast to everyone
        io.emit('objectBuilt', newObj);
    });

    // Handle Editing
    socket.on('editObject', (data) => {
        const objId = data.objId;
        const editType = data.editType;

        if (builtObjects[objId]) {
            // Only allow owner or server to edit
            if (builtObjects[objId].ownerId === socket.id || builtObjects[objId].ownerId === 'server') {
                builtObjects[objId].editType = editType;
                io.emit('objectEdited', { objId: objId, editType: editType });
            }
        }
    });

    // Handle Healing
    socket.on('useHeal', (data) => {
        if (players[socket.id] && !players[socket.id].isSpectator) {
            const lobbyId = players[socket.id].lobby;
            const mHealth = lobbies[lobbyId] ? lobbies[lobbyId].maxHealth || 100 : 100;
            players[socket.id].health = Math.min(mHealth, players[socket.id].health + (data.amount || 25));
            io.emit('playerHealthUpdate', { id: socket.id, health: players[socket.id].health });
        }
    });

    // Handle Emotes
    socket.on('triggerEmote', (data) => {
        io.emit('playerEmoting', { id: socket.id, emote: data.emote });
    });

    // Handle Weapon Pickups
    socket.on('pickupWeapon', (data) => {
        const spawnId = data.spawnId;
        if (weaponSpawns[spawnId] && weaponSpawns[spawnId].active) {
            weaponSpawns[spawnId].active = false;
            weaponSpawns[spawnId].respawnTime = Date.now() + 10000; // 10 second respawn

            // Tell this player they got it
            socket.emit('weaponPickedUp', { weaponType: weaponSpawns[spawnId].weaponType });

            // Tell everyone the spawn is disabled
            io.emit('weaponSpawnUpdate', { id: spawnId, active: false });
        }
    });

    // Handle Destroying Buildings
    socket.on('hitObject', (data) => {
        const objId = data.objId;
        const damage = data.damage || 35; // Use weapon damage or default
        if (builtObjects[objId]) {
            builtObjects[objId].health -= damage;

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

    // Check weapon respawns
    const now = Date.now();
    for (const id in weaponSpawns) {
        if (!weaponSpawns[id].active && now >= weaponSpawns[id].respawnTime) {
            weaponSpawns[id].active = true;
            io.emit('weaponSpawnUpdate', { id: id, active: true });
        }
    }

    // Process Lobbies (Storm logic and BR States)
    for (const lId in lobbies) {
        const lobby = lobbies[lId];
        const playersInLobby = Object.values(players).filter(p => p.lobby === lId && !p.isSpectator);

        if (lobby.mode === 'pve') {
            if (playersInLobby.length > 0) {
                if (lobby.botsAlive <= 0) {
                    lobby.currentWave++;
                    const botsToSpawn = lobby.currentWave * 3;
                    lobby.botsAlive = botsToSpawn;

                    for (let i=0; i<botsToSpawn; i++) {
                        const bId = `bot_${botIdCounter++}`;
                        bots[bId] = {
                            id: bId,
                            lobby: lId,
                            x: (Math.random() - 0.5) * 60,
                            y: 5,
                            z: (Math.random() - 0.5) * 60,
                            rotation: 0,
                            health: 50 + (lobby.currentWave * 10), // scales up
                            speed: 2 + (lobby.currentWave * 0.5)
                        };
                    }
                    io.emit('lobbyStateUpdate', lobby);
                }

                // Bot AI Logic
                const botsInLobby = Object.values(bots).filter(b => b.lobby === lId);
                botsInLobby.forEach(b => {
                    // Find nearest player
                    let nearestPlayer = null;
                    let minDist = Infinity;
                    playersInLobby.forEach(p => {
                        const dist = Math.sqrt(Math.pow(p.x - b.x, 2) + Math.pow(p.z - b.z, 2));
                        if (dist < minDist) {
                            minDist = dist;
                            nearestPlayer = p;
                        }
                    });

                    if (nearestPlayer) {
                        // Move towards player
                        const dx = nearestPlayer.x - b.x;
                        const dz = nearestPlayer.z - b.z;
                        const angle = Math.atan2(dx, dz);

                        if (minDist > 1.5) {
                            // Move
                            b.x += Math.sin(angle) * (b.speed / 20);
                            b.z += Math.cos(angle) * (b.speed / 20);
                            b.rotation = angle;
                        } else {
                            // Attack
                            if (Math.random() < 0.1) { // Random chance to attack per tick
                                nearestPlayer.health -= 15;
                                io.emit('playerHealthUpdate', { id: nearestPlayer.id, health: nearestPlayer.health });

                                if (nearestPlayer.health <= 0) {
                                    nearestPlayer.deaths++;
                                    io.emit('playerDied', { id: nearestPlayer.id, killerId: b.id });
                                    nearestPlayer.health = lobby.maxHealth || 100;
                                    nearestPlayer.x = 0; nearestPlayer.y = 5; nearestPlayer.z = 0;
                                    io.emit('playerRespawn', nearestPlayer);
                                }
                            }
                        }
                    }
                });

                io.emit('botsUpdate', botsInLobby);
            }
        } else if (lobby.mode === 'br' || lobby.mode === 'zonewars') {
            lobby.playersAlive = playersInLobby.length;

            if (lobby.state === 'waiting') {
                if (now > lobby.nextStormUpdate) {
                    lobby.state = 'playing';
                    lobby.stormPhase = 1;
                    lobby.stormRadius = lobby.mode === 'zonewars' ? 80 : 300;
                    lobby.nextStormUpdate = now + (lobby.mode === 'zonewars' ? 10000 : 30000);
                    io.emit('lobbyStateUpdate', lobby);

                    // Revive all waiting players
                    playersInLobby.forEach(p => { p.health = lobby.maxHealth || 100; io.emit('playerRespawn', p); });
                }
            } else if (lobby.state === 'playing') {
                if (now > lobby.nextStormUpdate) {
                    lobby.stormPhase++;
                    lobby.stormRadius *= 0.5; // Shrink zone by half

                    // Move center slightly
                    lobby.stormCenter.x += (Math.random() - 0.5) * lobby.stormRadius;
                    lobby.stormCenter.z += (Math.random() - 0.5) * lobby.stormRadius;

                    lobby.nextStormUpdate = now + (lobby.mode === 'zonewars' ? 15000 : 45000);
                    io.emit('lobbyStateUpdate', lobby);
                }

                // Storm damage calculation
                playersInLobby.forEach(p => {
                    const dx = p.x - lobby.stormCenter.x;
                    const dz = p.z - lobby.stormCenter.z;
                    const distSq = dx*dx + dz*dz;
                    if (distSq > lobby.stormRadius * lobby.stormRadius) {
                        p.health -= 5; // 5 dps in storm
                        if (p.health <= 0) {
                            p.health = 0;
                            p.isSpectator = true;
                            p.deaths++;
                            io.emit('playerMapUpdate', { id: p.id, map: p.map, isSpectator: true, lobby: lId, playerSkin: p.playerSkin, weaponSkin: p.weaponSkin });
                        }
                        io.emit('playerHealthUpdate', { id: p.id, health: p.health });
                    }
                });

                // Check win condition
                if (lobby.playersAlive <= 1) {
                    lobby.state = 'ended';
                    lobby.nextStormUpdate = now + 10000; // 10s until restart
                    io.emit('lobbyStateUpdate', lobby);
                }
            } else if (lobby.state === 'ended') {
                if (now > lobby.nextStormUpdate) {
                    // Restart
                    lobby.state = 'waiting';
                    lobby.stormPhase = 0;
                    lobby.nextStormUpdate = now + 10000;

                    // Cleanup builds in this lobby
                    for(let oId in builtObjects) {
                        if (builtObjects[oId].lobby === lId && builtObjects[oId].ownerId !== 'server') {
                            delete builtObjects[oId];
                            io.emit('objectDestroyed', { objId: oId });
                        }
                    }

                    // Revive everyone who was spectating but still connected
                    Object.values(players).filter(p => p.lobby === lId).forEach(p => {
                        p.isSpectator = false;
                        p.health = lobby.maxHealth || 100;
                        p.x = (Math.random() - 0.5) * 50;
                        p.y = 20; // drop them
                        p.z = (Math.random() - 0.5) * 50;
                        io.emit('playerMapUpdate', { id: p.id, map: p.map, isSpectator: false, lobby: lId, playerSkin: p.playerSkin, weaponSkin: p.weaponSkin });
                        io.emit('playerRespawn', p);
                    });

                    io.emit('lobbyStateUpdate', lobby);
                }
            }
        }
    }
}, 1000 / 20);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
