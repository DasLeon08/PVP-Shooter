import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';

// --- Audio System ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const AudioManager = {
    playShoot: () => {
        if(audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    },
    playHit: (isHeadshot = false) => {
        if(audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(isHeadshot ? 1200 : 800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(isHeadshot ? 2000 : 1200, audioCtx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    },
    playBuild: () => {
        if(audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(200, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.05);
    },
    playKill: () => {
         if(audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    },
    playFootstep: () => {
        if(audioCtx.state === 'suspended') audioCtx.resume();
        // Use a noise buffer for crunchier footsteps
        const bufferSize = audioCtx.sampleRate * 0.05; // 50ms of noise
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1000;
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        noise.start();
    }
};

let footstepTimer = 0;

// --- Globals ---
let camera, scene, renderer, composer;
let world;
let controls;
let playerBody;
let socket;
let myId;
let otherPlayers = {}; // To store meshes of other players
let botsLocal = {}; // AI Zombies
let currentMap = 'classic';
let health = 100;

let weaponSpawnsLocal = {}; // Store pickup meshes
let myWeapons = []; // Don't have weapons initially
let interactionText;

// Ammo System
const ammoState = {
    'ar': { current: 30, max: 30 },
    'smg': { current: 40, max: 40 },
    'shotgun': { current: 8, max: 8 },
    'sniper': { current: 5, max: 5 },
    'pistol': { current: 12, max: 12 }
};
let isReloading = false;

// Build System State
let currentMode = 'hands'; // weapon, wall, floor, ramp
const GRID_SIZE = 5;
let gunMesh;

// Weapon, Movement & Camera Sway State
const baseGunPosition = new THREE.Vector3(0.3, -0.3, -0.5);
let gunSwayVelocity = new THREE.Vector2(0, 0);
let bobTimer = 0;
let isSprinting = false;
let isCrouching = false;
let isSliding = false;
let slideTimer = 0;
let targetFov = 75;
let currentCrosshairSpread = 20;
let isAiming = false;
let weaponRecoilState = false;
let weaponRecoilTimer = 0;
let screenShakeIntensity = 0;
let defaultMaterial;
let isShooting = false;
let lastShotTime = 0;

// Particles
let particles = [];
const particleGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const sparkMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
const debrisMat = new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.8 });

// Create a solid procedural structural texture for buildings (1v1.lol V8)
const canvas = document.createElement('canvas');
canvas.width = 512; canvas.height = 512;
const ctx = canvas.getContext('2d');
// Dark, solid metallic base instead of overly transparent glass
ctx.fillStyle = '#1A1A24';
ctx.fillRect(0, 0, 512, 512);

// Thick outer structural borders
ctx.strokeStyle = '#00FFCC';
ctx.lineWidth = 12;
ctx.strokeRect(0, 0, 512, 512);

// Internal cross-bracing (X pattern)
ctx.strokeStyle = 'rgba(0, 255, 204, 0.5)';
ctx.lineWidth = 6;
ctx.beginPath();
ctx.moveTo(0, 0); ctx.lineTo(512, 512);
ctx.moveTo(512, 0); ctx.lineTo(0, 512);
ctx.stroke();

// Internal grid lines (for scale and texture)
ctx.strokeStyle = 'rgba(0, 255, 204, 0.15)';
ctx.lineWidth = 2;
ctx.beginPath();
for (let i = 0; i < 512; i += 64) {
    ctx.moveTo(i, 0); ctx.lineTo(i, 512);
    ctx.moveTo(0, i); ctx.lineTo(512, i);
}
ctx.stroke();

// Glow dots at corners
ctx.fillStyle = '#FFFFFF';
ctx.shadowBlur = 10;
ctx.shadowColor = '#00FFCC';
ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI*2); ctx.fill();
ctx.beginPath(); ctx.arc(512, 0, 8, 0, Math.PI*2); ctx.fill();
ctx.beginPath(); ctx.arc(0, 512, 8, 0, Math.PI*2); ctx.fill();
ctx.beginPath(); ctx.arc(512, 512, 8, 0, Math.PI*2); ctx.fill();
ctx.shadowBlur = 0;

// Procedural Bump Map for Building Texture
const bumpCanvas = document.createElement('canvas');
bumpCanvas.width = 512; bumpCanvas.height = 512;
const bctx = bumpCanvas.getContext('2d');
bctx.fillStyle = '#000000'; // Base height (low)
bctx.fillRect(0, 0, 512, 512);
// Raised edges
bctx.strokeStyle = '#FFFFFF'; // Max height
bctx.lineWidth = 12;
bctx.strokeRect(0, 0, 512, 512);
// Raised inner bracing
bctx.strokeStyle = '#888888'; // Mid height
bctx.lineWidth = 6;
bctx.beginPath(); bctx.moveTo(0, 0); bctx.lineTo(512, 512); bctx.moveTo(512, 0); bctx.lineTo(0, 512); bctx.stroke();

const gridTexture = new THREE.CanvasTexture(canvas);
gridTexture.wrapS = THREE.RepeatWrapping;
gridTexture.wrapT = THREE.RepeatWrapping;
gridTexture.repeat.set(1, 1); // 1 to 1 mapping with grid piece

const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
bumpTexture.wrapS = THREE.RepeatWrapping; bumpTexture.wrapT = THREE.RepeatWrapping;
bumpTexture.repeat.set(1, 1);

const buildMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xeeeeff,
    map: gridTexture,
    bumpMap: bumpTexture,
    bumpScale: 0.05,
    metalness: 0.9,
    roughness: 0.1,
    transparent: true,
    opacity: 0.9, // Allow more light for transmission
    transmission: 0.5, // Glass-like effect (Graphics V14)
    ior: 1.5, // Index of refraction
    thickness: 0.5,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    emissive: 0x002222, // Subtle glow
    side: THREE.DoubleSide
});

// Ghost material changed to pulsing hologram effect (simulated via high opacity + double side + custom texture)
const ghostCanvas = document.createElement('canvas');
ghostCanvas.width = 256; ghostCanvas.height = 256;
const gtx = ghostCanvas.getContext('2d');
gtx.fillStyle = 'rgba(0, 255, 204, 0.3)'; gtx.fillRect(0, 0, 256, 256);
gtx.strokeStyle = '#00ffcc'; gtx.lineWidth = 8; gtx.strokeRect(0, 0, 256, 256);
const ghostTex = new THREE.CanvasTexture(ghostCanvas);

const ghostMaterial = new THREE.MeshStandardMaterial({
    map: ghostTex, color: 0x00ffcc, transparent: true, opacity: 0.6, depthWrite: false,
    emissive: 0x00ffcc, emissiveIntensity: 0.8, side: THREE.DoubleSide
});
let ghostMesh;
let ghostRampMesh; // Separate mesh needed for ramp rotation visually
let builtObjects = [];
let placementRotation = 0; // 0, 1, 2, 3 (* 90 degrees)

// Environment References for Animation
let activeGroundMesh;
let oceanMesh;
let dustParticles;
let globalSky;
let globalDirLight;
let timeOfDay = 8; // Hours

// Movement state
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let canJump = false;

// Physics parameters
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const speed = 10.0;
const jumpVelocity = 8.0;

let prevTime = performance.now();

// Start menu logic
let isSpectator = false;

let currentLobby = '';
let currentGameMode = 'ffa';
let currentMaxHealth = 100;
let stormMesh;

// --- SHOP & CURRENCY SYSTEM ---
let coins = parseInt(localStorage.getItem('fpsCoins')) || 0;
let ownedPlayerSkins = JSON.parse(localStorage.getItem('fpsOwnedPlayerSkins')) || ['default'];
let ownedWeaponSkins = JSON.parse(localStorage.getItem('fpsOwnedWeaponSkins')) || ['default'];
let ownedEmotes = JSON.parse(localStorage.getItem('fpsOwnedEmotes')) || ['none'];
let equippedPlayerSkin = localStorage.getItem('fpsEquippedPlayerSkin') || 'default';
let equippedWeaponSkin = localStorage.getItem('fpsEquippedWeaponSkin') || 'default';
let equippedEmote = localStorage.getItem('fpsEquippedEmote') || 'none';

const playerSkins = [
    { id: 'default', name: 'Basic Red', price: 0, color: 0xff0044 },
    { id: 'blue', name: 'Azure Blue', price: 100, color: 0x00aaff },
    { id: 'green', name: 'Toxic Slime', price: 250, color: 0x33ff00 },
    { id: 'gold', name: 'Solid Gold', price: 500, color: 0xffaa00 },
    { id: 'phantom', name: 'Phantom White', price: 750, color: 0xeeeeee },
    { id: 'cyber', name: 'Cyberpunk', price: 1000, color: 0xcc00ff },
    { id: 'stealth', name: 'Stealth Black', price: 1500, color: 0x111111 },
    { id: 'magma', name: 'Magma Core', price: 2500, color: 0xff3300 }
];

const weaponSkins = [
    { id: 'default', name: 'Standard Grey', price: 0, color: 0x2A2A30 },
    { id: 'camo', name: 'Desert Camo', price: 150, color: 0xC2B280 },
    { id: 'neon', name: 'Neon Green', price: 200, color: 0x00ff00 },
    { id: 'glacier', name: 'Glacier Blue', price: 300, color: 0x88ccff },
    { id: 'crimson', name: 'Crimson Red', price: 400, color: 0xaa0000 },
    { id: 'galactic', name: 'Galactic Purple', price: 800, color: 0x6600cc },
    { id: 'obsidian', name: 'Obsidian', price: 1200, color: 0x0a0a0a },
    { id: 'darkmatter', name: 'Dark Matter', price: 2000, color: 0x050505 }
];

const availableEmotes = [
    { id: 'none', name: 'None', price: 0 },
    { id: 'wave', name: 'Wave', price: 50 },
    { id: 'spin', name: 'Spin', price: 150 },
    { id: 'flip', name: 'Backflip', price: 300 },
    { id: 'tpose', name: 'T-Pose', price: 400 },
    { id: 'headbang', name: 'Headbang', price: 600 },
    { id: 'levitate', name: 'Levitate', price: 1000 },
    { id: 'floss', name: 'Floss Dance', price: 1500 }
];

function updateMenuCoinsDisplay() {
    const displays = document.querySelectorAll('#menuCoinsDisplay, #shopBalanceDisplay');
    displays.forEach(d => d.innerText = coins);
}
updateMenuCoinsDisplay(); // Initial set

function renderShop() {
    const pGrid = document.getElementById('playerSkinsGrid');
    const wGrid = document.getElementById('weaponSkinsGrid');
    const eGrid = document.getElementById('emotesGrid');

    pGrid.innerHTML = '';
    playerSkins.forEach(skin => {
        const isOwned = ownedPlayerSkins.includes(skin.id);
        const isEquipped = equippedPlayerSkin === skin.id;

        const div = document.createElement('div');
        div.className = `shop-item ${isOwned ? 'owned' : ''} ${isEquipped ? 'equipped' : ''}`;
        div.innerHTML = `
            <div class="item-name" style="color: #${skin.color.toString(16).padStart(6, '0')}">${skin.name}</div>
            <div class="item-price ${isOwned ? 'owned-text' : ''}">${isEquipped ? 'Equipped' : isOwned ? 'Owned' : skin.price + ' Coins'}</div>
        `;
        div.onclick = () => {
            if (isOwned) {
                equippedPlayerSkin = skin.id;
                localStorage.setItem('fpsEquippedPlayerSkin', skin.id);
                renderShop();
            } else if (coins >= skin.price) {
                coins -= skin.price;
                ownedPlayerSkins.push(skin.id);
                equippedPlayerSkin = skin.id;
                localStorage.setItem('fpsCoins', coins);
                localStorage.setItem('fpsOwnedPlayerSkins', JSON.stringify(ownedPlayerSkins));
                localStorage.setItem('fpsEquippedPlayerSkin', skin.id);
                updateMenuCoinsDisplay();
                renderShop();
            }
        };
        pGrid.appendChild(div);
    });

    wGrid.innerHTML = '';
    weaponSkins.forEach(skin => {
        const isOwned = ownedWeaponSkins.includes(skin.id);
        const isEquipped = equippedWeaponSkin === skin.id;

        const div = document.createElement('div');
        div.className = `shop-item ${isOwned ? 'owned' : ''} ${isEquipped ? 'equipped' : ''}`;
        div.innerHTML = `
            <div class="item-name" style="color: #${skin.color.toString(16).padStart(6, '0')}">${skin.name}</div>
            <div class="item-price ${isOwned ? 'owned-text' : ''}">${isEquipped ? 'Equipped' : isOwned ? 'Owned' : skin.price + ' Coins'}</div>
        `;
        div.onclick = () => {
            if (isOwned) {
                equippedWeaponSkin = skin.id;
                localStorage.setItem('fpsEquippedWeaponSkin', skin.id);
                renderShop();
            } else if (coins >= skin.price) {
                coins -= skin.price;
                ownedWeaponSkins.push(skin.id);
                equippedWeaponSkin = skin.id;
                localStorage.setItem('fpsCoins', coins);
                localStorage.setItem('fpsOwnedWeaponSkins', JSON.stringify(ownedWeaponSkins));
                localStorage.setItem('fpsEquippedWeaponSkin', skin.id);
                updateMenuCoinsDisplay();
                renderShop();
            }
        };
        wGrid.appendChild(div);
    });

    eGrid.innerHTML = '';
    availableEmotes.forEach(emote => {
        const isOwned = ownedEmotes.includes(emote.id);
        const isEquipped = equippedEmote === emote.id;

        const div = document.createElement('div');
        div.className = `shop-item ${isOwned ? 'owned' : ''} ${isEquipped ? 'equipped' : ''}`;
        div.innerHTML = `
            <div class="item-name" style="color: #ff00ff">${emote.name}</div>
            <div class="item-price ${isOwned ? 'owned-text' : ''}">${isEquipped ? 'Equipped' : isOwned ? 'Owned' : emote.price + ' Coins'}</div>
        `;
        div.onclick = () => {
            if (isOwned) {
                equippedEmote = emote.id;
                localStorage.setItem('fpsEquippedEmote', emote.id);
                renderShop();
            } else if (coins >= emote.price) {
                coins -= emote.price;
                ownedEmotes.push(emote.id);
                equippedEmote = emote.id;
                localStorage.setItem('fpsCoins', coins);
                localStorage.setItem('fpsOwnedEmotes', JSON.stringify(ownedEmotes));
                localStorage.setItem('fpsEquippedEmote', emote.id);
                updateMenuCoinsDisplay();
                renderShop();
            }
        };
        eGrid.appendChild(div);
    });
}

document.getElementById('openShopBtn').addEventListener('click', () => {
    document.getElementById('mainMenu').style.display = 'none';
    document.getElementById('shopMenu').style.display = 'flex';
    renderShop();
});

document.getElementById('closeShopBtn').addEventListener('click', () => {
    document.getElementById('shopMenu').style.display = 'none';
    document.getElementById('mainMenu').style.display = 'flex';
});

document.getElementById('introScreen').addEventListener('click', () => {
    document.getElementById('introScreen').style.opacity = '0';
    setTimeout(() => {
        document.getElementById('introScreen').style.display = 'none';
        document.getElementById('mainMenu').style.display = 'flex';
    }, 500);
});

// Initially hide main menu to let intro show
document.getElementById('mainMenu').style.display = 'none';

document.getElementById('playBtn').addEventListener('click', () => {
    isSpectator = false;
    document.getElementById('mainMenu').style.display = 'none';
    currentLobby = document.getElementById('lobbyCodeInput').value.trim() || 'public';
    currentGameMode = document.getElementById('gameModeSelect').value;
    currentMaxHealth = parseInt(document.getElementById('healthSelect').value) || 100;

    // Show UI
    document.getElementById('crosshair').style.display = 'block';
    document.getElementById('ui').style.display = 'block';
    document.getElementById('hotbar').style.display = 'flex';
    document.getElementById('healthBarContainer').style.display = 'block';
    document.getElementById('minimapContainer').style.display = 'block';
    document.getElementById('instructions').style.display = 'flex';

    // Show Emote Hint if one is equipped
    const emoteHint = document.getElementById('emoteHelpText');
    if (equippedEmote !== 'none') {
        emoteHint.style.display = 'block';
        const emoteName = availableEmotes.find(e => e.id === equippedEmote)?.name || 'Emote';
        document.getElementById('equippedEmoteName').innerText = emoteName;
    } else {
        emoteHint.style.display = 'none';
    }

    currentMap = document.getElementById('mapSelect').value;

    initNetwork();
    init();
    animate();
});

document.getElementById('spectateBtn').addEventListener('click', () => {
    isSpectator = true;
    document.getElementById('mainMenu').style.display = 'none';
    currentLobby = document.getElementById('lobbyCodeInput').value.trim() || 'public';
    currentGameMode = document.getElementById('gameModeSelect').value;
    currentMaxHealth = parseInt(document.getElementById('healthSelect').value) || 100;

    // Hide combat UI for spectators
    document.getElementById('crosshair').style.display = 'none';
    document.getElementById('ui').style.display = 'none';
    document.getElementById('hotbar').style.display = 'none';
    document.getElementById('healthBarContainer').style.display = 'none';
    document.getElementById('minimapContainer').style.display = 'none';
    document.getElementById('instructions').style.display = 'flex'; // Still need instructions to start

    currentMap = document.getElementById('mapSelect').value;

    initNetwork();
    init();
    animate();
});

function initNetwork() {
    socket = io();

    socket.on('leaderboardUpdate', (players) => {
        const tbody = document.getElementById('leaderboardBody');
        tbody.innerHTML = '';

        // Filter out players in other lobbies or map
        const lobbyPlayers = players.filter(p => p.lobby === currentLobby && p.map === currentMap);

        // Sort by kills
        const sorted = lobbyPlayers.sort((a, b) => b.kills - a.kills);

        sorted.forEach(p => {
            if (p.isSpectator) return;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding: 5px;">${p.id === myId ? 'You' : p.id.substring(0,6)}</td>
                <td style="padding: 5px; color: #00ffcc;">${p.kills || 0}</td>
                <td style="padding: 5px; color: #ff5555;">${p.deaths || 0}</td>
            `;
            tbody.appendChild(tr);
        });
    });

    socket.on('initGame', (data) => {
        myId = data.socketId;

        socket.emit('joinMap', {
            map: currentMap,
            isSpectator: isSpectator,
            lobby: currentLobby,
            gameMode: currentGameMode,
            maxHealth: currentMaxHealth,
            playerSkin: equippedPlayerSkin,
            weaponSkin: equippedWeaponSkin
        });

        // Load existing buildings from the lobby
        const existingObjects = data.builtObjects;
        for (let objId in existingObjects) {
            if (existingObjects[objId].map === currentMap && existingObjects[objId].lobby === currentLobby) {
                 spawnBuildingFromServer(existingObjects[objId]);
            }
        }

        // Load weapon spawns
        const spawns = data.weaponSpawns;
        for (let spawnId in spawns) {
            if (spawns[spawnId].map === currentMap && spawns[spawnId].lobby === currentLobby) {
                 spawnWeaponPickup(spawns[spawnId]);
            }
        }
    });

    socket.on('weaponSpawnUpdate', (data) => {
        const localSpawn = weaponSpawnsLocal[data.id];
        if (localSpawn) {
            localSpawn.mesh.visible = data.active;
            localSpawn.active = data.active;
        }
    });

    socket.on('weaponPickedUp', (data) => {
        if (!myWeapons.includes(data.weaponType)) {
            myWeapons.push(data.weaponType);
            setMode(data.weaponType);
        } else {
            // Already have it, refill ammo? (If ammo system exists, skipping for now)
            setMode(data.weaponType);
        }
    });

    socket.on('lobbyStateUpdate', (lobby) => {
        if (lobby.id !== currentLobby) return;

        const statusEl = document.getElementById('stormStatus');
        const aliveEl = document.getElementById('playersAlive');
        const aliveCount = document.getElementById('aliveCount');
        const waveStatus = document.getElementById('waveStatus');
        const waveCount = document.getElementById('waveCount');
        const botsStatus = document.getElementById('botsAlive');
        const botCount = document.getElementById('botCount');

        if (lobby.mode === 'pve') {
            statusEl.style.display = 'none';
            aliveEl.style.display = 'none';
            waveStatus.style.display = 'block';
            botsStatus.style.display = 'block';
            waveCount.innerText = lobby.currentWave;
            botCount.innerText = lobby.botsAlive;
        } else if (lobby.mode === 'br' || lobby.mode === 'zonewars') {
            waveStatus.style.display = 'none';
            botsStatus.style.display = 'none';
            statusEl.style.display = 'block';
            aliveEl.style.display = 'block';

            if (lobby.state === 'waiting') {
                statusEl.innerText = `Waiting for Match...`;
                statusEl.style.color = '#fff';
            } else if (lobby.state === 'playing') {
                statusEl.innerText = `Storm Phase ${lobby.stormPhase}`;
                statusEl.style.color = '#cc00ff';
            } else if (lobby.state === 'ended') {
                statusEl.innerText = `Match Ended!`;
                statusEl.style.color = '#00ffcc';
            }

            aliveCount.innerText = lobby.playersAlive;

            // Update or create Storm Mesh
            if (lobby.state === 'playing') {
                if (!stormMesh) {
                    const stormGeo = new THREE.CylinderGeometry(1, 1, 500, 32, 1, true);
                    const stormMat = new THREE.MeshStandardMaterial({
                        color: 0x8800ff, transparent: true, opacity: 0.3,
                        side: THREE.DoubleSide, emissive: 0x440088, depthWrite: false
                    });
                    stormMesh = new THREE.Mesh(stormGeo, stormMat);
                    scene.add(stormMesh);
                }
                // Animate storm radius shrinking
                stormMesh.targetRadius = lobby.stormRadius;
                stormMesh.targetPosition = new THREE.Vector3(lobby.stormCenter.x, 0, lobby.stormCenter.z);
            } else {
                if (stormMesh) {
                    scene.remove(stormMesh);
                    stormMesh = null;
                }
            }
        } else {
            statusEl.style.display = 'none';
            aliveEl.style.display = 'none';
            waveStatus.style.display = 'none';
            botsStatus.style.display = 'none';
        }
    });

    socket.on('botsUpdate', (botsData) => {
        const currentIds = [];
        botsData.forEach(b => {
            currentIds.push(b.id);
            if (!botsLocal[b.id]) {
                const botGroup = new THREE.Group();
                const bodyGeo = new THREE.BoxGeometry(0.8, 1.2, 0.4);
                const bodyMat = new THREE.MeshStandardMaterial({ color: 0x224422, roughness: 0.8 }); // Zombie green
                const bBodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
                bBodyMesh.position.y = 0.6;
                bBodyMesh.castShadow = true;

                const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
                const headMesh = new THREE.Mesh(headGeo, bodyMat);
                headMesh.position.y = 1.45;
                headMesh.castShadow = true;

                const eyeGeo = new THREE.BoxGeometry(0.4, 0.1, 0.1);
                const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0 });
                const eyeMesh = new THREE.Mesh(eyeGeo, eyeMat);
                eyeMesh.position.set(0, 1.45, -0.26);

                const hitboxGeo = new THREE.BoxGeometry(1, 2, 1);
                const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
                const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
                hitbox.position.y = 1;
                hitbox.userData = { isBot: true, id: b.id };

                botGroup.add(bBodyMesh, headMesh, eyeMesh, hitbox);
                scene.add(botGroup);

                botsLocal[b.id] = { group: botGroup, hitbox: hitbox };
            }

            botsLocal[b.id].group.position.set(b.x, b.y - 0.5, b.z);
            botsLocal[b.id].group.rotation.y = b.rotation;
        });

        // Cleanup dead bots
        for (let id in botsLocal) {
            if (!currentIds.includes(id)) {
                scene.remove(botsLocal[id].group);
                delete botsLocal[id];
            }
        }
    });

    socket.on('botDestroyed', (data) => {
        if (botsLocal[data.id]) {
            createParticles(botsLocal[data.id].group.position, 'debris', 10);
            scene.remove(botsLocal[data.id].group);
            delete botsLocal[data.id];
        }
    });

    // Handle building events from server
    socket.on('objectBuilt', (data) => {
        // If it's ours, we already placed it locally, so we replace the temp one
        if (data.ownerId === myId) {
            // Find temp object
            const tempIndex = builtObjects.findIndex(o => o.isTemp);
            if (tempIndex > -1) {
                builtObjects[tempIndex].id = data.id;
                builtObjects[tempIndex].mesh.userData.id = data.id;
                builtObjects[tempIndex].isTemp = false;
            }
            return;
        }
        if (data.map !== currentMap || data.lobby !== currentLobby) return;

        spawnBuildingFromServer(data);
    });

    socket.on('objectEdited', (data) => {
        const objId = data.objId;
        const index = builtObjects.findIndex(obj => obj.id === objId);
        if (index > -1) {
            const obj = builtObjects[index];
            const editType = data.editType;

            // Remove old geometry
            obj.mesh.geometry.dispose();

            if (obj.body.userData.type === 'wall' && editType === 'door') {
                // Wall with door hole
                const doorShape = new THREE.Shape();
                doorShape.moveTo(-GRID_SIZE/2, -GRID_SIZE/2);
                doorShape.lineTo(GRID_SIZE/2, -GRID_SIZE/2);
                doorShape.lineTo(GRID_SIZE/2, GRID_SIZE/2);
                doorShape.lineTo(-GRID_SIZE/2, GRID_SIZE/2);
                doorShape.lineTo(-GRID_SIZE/2, -GRID_SIZE/2);

                const hole = new THREE.Path();
                hole.moveTo(-1, -GRID_SIZE/2);
                hole.lineTo(1, -GRID_SIZE/2);
                hole.lineTo(1, 1);
                hole.lineTo(-1, 1);
                hole.lineTo(-1, -GRID_SIZE/2);
                doorShape.holes.push(hole);

                const extrudeSettings = { depth: 0.5, bevelEnabled: false };
                obj.mesh.geometry = new THREE.ExtrudeGeometry(doorShape, extrudeSettings);
                // Fix extrude translation
                obj.mesh.geometry.translate(0, 0, -0.25);

                // Adjust physics (naive approach: just make it non-colliding in center or rely on the visual change for now, proper trimesh needed for perfect collision but box is okay)
                world.removeBody(obj.body);
                const p1 = new CANNON.Box(new CANNON.Vec3(0.75, GRID_SIZE/2, 0.25));
                const p2 = new CANNON.Box(new CANNON.Vec3(0.75, GRID_SIZE/2, 0.25));
                const p3 = new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, 0.75, 0.25)); // top piece

                const newBody = new CANNON.Body({ mass: 0, material: defaultMaterial });
                newBody.addShape(p1, new CANNON.Vec3(-1.75, 0, 0));
                newBody.addShape(p2, new CANNON.Vec3(1.75, 0, 0));
                newBody.addShape(p3, new CANNON.Vec3(0, 1.75, 0));
                newBody.position.copy(obj.body.position);
                newBody.quaternion.copy(obj.body.quaternion);
                newBody.userData = obj.body.userData;
                world.addBody(newBody);
                obj.body = newBody;

            } else if (obj.body.userData.type === 'floor' && editType === 'half') {
                obj.mesh.geometry = new THREE.BoxGeometry(GRID_SIZE/2, 0.5, GRID_SIZE);
                obj.mesh.geometry.translate(-GRID_SIZE/4, 0, 0); // shift half

                world.removeBody(obj.body);
                const newShape = new CANNON.Box(new CANNON.Vec3(GRID_SIZE/4, 0.25, GRID_SIZE/2));
                const newBody = new CANNON.Body({ mass: 0, material: defaultMaterial, shape: newShape });
                newBody.position.copy(obj.body.position);
                newBody.quaternion.copy(obj.body.quaternion);

                // Shift physics position
                const offset = new CANNON.Vec3(-GRID_SIZE/4, 0, 0);
                offset.x = offset.x * Math.cos(newBody.quaternion.y) - offset.z * Math.sin(newBody.quaternion.y); // simplified rotation
                newBody.position.vadd(offset, newBody.position);

                newBody.userData = obj.body.userData;
                world.addBody(newBody);
                obj.body = newBody;
            }

            // Update outlines
            obj.mesh.children.forEach(c => { if(c.isLineSegments) obj.mesh.remove(c); });
            const edges = new THREE.EdgesGeometry(obj.mesh.geometry);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00ffcc, linewidth: 4, opacity: 0.9, transparent: true }));
            obj.mesh.add(line);
        }
    });

    socket.on('objectDestroyed', (data) => {
        const objId = data.objId;
        const index = builtObjects.findIndex(obj => obj.id === objId);
        if (index > -1) {
            const obj = builtObjects[index];

            // Spawn debris particles
            createParticles(obj.mesh.position, 'debris', 15);

            scene.remove(obj.mesh);
            world.removeBody(obj.body);
            obj.mesh.geometry.dispose();
            builtObjects.splice(index, 1);
        }
    });

    socket.on('objectHealthUpdate', (data) => {
        const objId = data.objId;
        const obj = builtObjects.find(o => o.id === objId);
        if (obj) {
            obj.mesh.userData.health = data.health;
            // Visual hit feedback
            const oldColor = obj.mesh.material.color.getHex();
            obj.mesh.material.color.setHex(0xff0000);
            setTimeout(() => {
                if (obj && obj.mesh.material) obj.mesh.material.color.setHex(oldColor);
            }, 100);
        }
    });

    // When we get update of all players
    socket.on('gameStateUpdate', (players) => {
        for (let id in players) {
            let p = players[id];

            // Don't render ourselves, players on different maps, or in different lobbies
            if (id === myId) continue;

            if (p.map !== currentMap || p.lobby !== currentLobby || p.isSpectator) {
                 if (otherPlayers[id]) {
                     scene.remove(otherPlayers[id].group);
                     delete otherPlayers[id];
                 }
                 continue;
            }

            // Create mesh if it doesn't exist
            if (!otherPlayers[id]) {
                const playerGroup = new THREE.Group();

                // Resolve skin color
                let skinColor = 0xff0044; // default
                let headColor = 0xff3333; // default
                const skinSetting = p.playerSkin || 'default';
                const foundSkin = playerSkins.find(s => s.id === skinSetting);
                if (foundSkin) {
                    skinColor = foundSkin.color;
                    // Slightly lighter color for head
                    headColor = new THREE.Color(skinColor).lerp(new THREE.Color(0xffffff), 0.2).getHex();
                }

                // Body
                const bodyGeo = new THREE.BoxGeometry(0.8, 1.2, 0.4);
                const bodyMat = new THREE.MeshStandardMaterial({ color: skinColor, metalness: 0.6, roughness: 0.2 });
                const pBodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
                pBodyMesh.position.y = 0.6; // Body rests on group origin (feet)
                pBodyMesh.castShadow = true;

                // Head
                const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
                const headMat = new THREE.MeshStandardMaterial({ color: headColor, metalness: 0.5, roughness: 0.5 });
                const headMesh = new THREE.Mesh(headGeo, headMat);
                headMesh.position.y = 1.45; // Top of body
                headMesh.castShadow = true;

                // Visor / Eye (Cyberpunk style)
                const visorGeo = new THREE.BoxGeometry(0.4, 0.1, 0.1);
                const visorMat = new THREE.MeshStandardMaterial({ color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 2.0 });
                const visorMesh = new THREE.Mesh(visorGeo, visorMat);
                visorMesh.position.set(0, 1.45, -0.26); // Front of face

                // Backpack / Jetpack
                const packGeo = new THREE.BoxGeometry(0.6, 0.8, 0.2);
                const packMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(skinColor).lerp(new THREE.Color(0x000000), 0.5).getHex(), metalness: 0.8, roughness: 0.3 });
                const packMesh = new THREE.Mesh(packGeo, packMat);
                packMesh.position.set(0, 0.6, 0.3);
                packMesh.castShadow = true;

                // Arms (Blocky, holding an invisible weapon posture)
                const armGeo = new THREE.BoxGeometry(0.25, 0.8, 0.25);
                const armMat = new THREE.MeshStandardMaterial({ color: skinColor, metalness: 0.6, roughness: 0.2 });
                const leftArm = new THREE.Mesh(armGeo, armMat);
                leftArm.position.set(-0.55, 0.6, -0.3); leftArm.rotation.x = -Math.PI / 4; leftArm.castShadow = true;
                const rightArm = new THREE.Mesh(armGeo, armMat);
                rightArm.position.set(0.55, 0.6, -0.3); rightArm.rotation.x = -Math.PI / 4; rightArm.castShadow = true;

                // Legs (Blocky)
                const legGeo = new THREE.BoxGeometry(0.3, 0.6, 0.3);
                const legMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(skinColor).lerp(new THREE.Color(0x000000), 0.3).getHex(), metalness: 0.6, roughness: 0.2 });
                const leftLeg = new THREE.Mesh(legGeo, legMat);
                leftLeg.position.set(-0.2, -0.3, 0); leftLeg.castShadow = true; // Relative to body
                const rightLeg = new THREE.Mesh(legGeo, legMat);
                rightLeg.position.set(0.2, -0.3, 0); rightLeg.castShadow = true;

                // Feet
                const footGeo = new THREE.BoxGeometry(0.32, 0.15, 0.4);
                const footMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
                const leftFoot = new THREE.Mesh(footGeo, footMat); leftFoot.position.set(0, -0.3, 0.05); leftLeg.add(leftFoot);
                const rightFoot = new THREE.Mesh(footGeo, footMat); rightFoot.position.set(0, -0.3, 0.05); rightLeg.add(rightFoot);

                pBodyMesh.add(leftLeg, rightLeg); // Add legs to body so they move with it
                pBodyMesh.add(packMesh); // Attach pack to body

                playerGroup.add(pBodyMesh);
                playerGroup.add(headMesh);
                playerGroup.add(visorMesh);
                playerGroup.add(leftArm);
                playerGroup.add(rightArm);

                // Invisible hitbox for raycaster
                const hitboxGeo = new THREE.BoxGeometry(1, 2, 1);
                const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
                const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
                hitbox.position.y = 1; // Center of full height
                hitbox.userData = { isPlayer: true, id: id };
                playerGroup.add(hitbox);

                scene.add(playerGroup);

                otherPlayers[id] = {
                    group: playerGroup,
                    hitbox: hitbox, // Store hitbox reference for shooting
                    activeEmote: 'none',
                    emoteTimer: 0
                };
            }

            // Update position and rotation smoothly
            // Adjust y so feet are at ground level (player physics body radius is 0.5, position is center)
            otherPlayers[id].group.position.set(p.x, p.y - 0.5, p.z);
            // Only update body rotation if not spinning
            if (otherPlayers[id].activeEmote !== 'spin') {
                otherPlayers[id].group.rotation.y = p.rotation;
            }
        }

        // Remove players that disconnected
        for (let id in otherPlayers) {
            if (!players[id] || players[id].map !== currentMap) {
                scene.remove(otherPlayers[id].group);
                delete otherPlayers[id];
            }
        }
    });

    socket.on('playerHealthUpdate', (data) => {
        if (data.id === myId) {
            health = data.health;
            const healthPct = Math.max(0, (health / currentMaxHealth) * 100);
            document.getElementById('healthBar').style.width = healthPct + '%';
            document.getElementById('healthText').innerText = `${health} HP`;

            // Low health pulse effect
            const overlay = document.getElementById('lowHealthOverlay');
            if (health > 0 && health <= 30) {
                overlay.style.boxShadow = 'inset 0 0 150px 50px rgba(255, 0, 0, 0.6)';
            } else {
                overlay.style.boxShadow = 'inset 0 0 150px 50px rgba(255, 0, 0, 0)';
            }
        } else if (otherPlayers[data.id]) {
            // Flash enemy player red when they take damage
            const group = otherPlayers[data.id].group;
            group.children.forEach(mesh => {
                if(mesh.material) {
                    const originalEmissive = mesh.material.emissive ? mesh.material.emissive.clone() : new THREE.Color(0x000000);
                    mesh.material.emissive = new THREE.Color(0xff0000);
                    setTimeout(() => {
                        if(mesh.material) mesh.material.emissive = originalEmissive;
                    }, 100);
                }
            });
        }
    });

    socket.on('botHit', (data) => {
        if (botsLocal[data.id]) {
            const group = botsLocal[data.id].group;
            group.children.forEach(mesh => {
                if(mesh.material) {
                    const originalEmissive = mesh.material.emissive ? mesh.material.emissive.clone() : new THREE.Color(0x000000);
                    mesh.material.emissive = new THREE.Color(0xff0000);
                    setTimeout(() => {
                        if(mesh.material) mesh.material.emissive = originalEmissive;
                    }, 100);
                }
            });
        }
    });

    socket.on('playerEmoting', (data) => {
        if (otherPlayers[data.id]) {
            otherPlayers[data.id].activeEmote = data.emote;
            otherPlayers[data.id].emoteTimer = performance.now();
        }
    });

    socket.on('playerDied', (data) => {
        // Add to kill feed
        const killFeed = document.getElementById('killFeed');
        const entry = document.createElement('div');
        entry.style.background = 'rgba(0,0,0,0.5)';
        entry.style.padding = '5px 10px';
        entry.style.borderRadius = '3px';
        entry.style.borderLeft = '3px solid #ff00ff';
        entry.style.color = 'white';
        entry.style.fontSize = '18px';
        entry.innerHTML = `<span style="color: #00ffcc">${data.killerId ? 'Player' : 'Environment'}</span> killed <span style="color: #ff3333">Player</span>`;
        if (data.killerId === myId) entry.innerHTML = `<span style="color: #00ffcc">You</span> killed <span style="color: #ff3333">Player</span>`;
        killFeed.appendChild(entry);
        setTimeout(() => {
            entry.style.transition = 'opacity 1s';
            entry.style.opacity = '0';
            setTimeout(() => entry.remove(), 1000);
        }, 4000);

        // If we got the kill, reward 10 coins per kill
        if (data.killerId === myId) {
            coins += 10;
            localStorage.setItem('fpsCoins', coins);
            updateMenuCoinsDisplay();

            AudioManager.playKill();

            // Show a visual +10 Coins on screen
            const coinText = document.createElement('div');
            coinText.innerText = "+10 Coins";
            coinText.style.position = "absolute";
            coinText.style.top = "50%";
            coinText.style.left = "50%";
            coinText.style.transform = "translate(-50%, -50%)";
            coinText.style.color = "#ffaa00";
            coinText.style.fontSize = "40px";
            coinText.style.fontWeight = "bold";
            coinText.style.textShadow = "0 0 10px #ffaa00";
            coinText.style.zIndex = "100";
            document.body.appendChild(coinText);

            // Animate up and fade out
            let posY = 50;
            let opacity = 1;
            const anim = setInterval(() => {
                posY -= 0.5;
                opacity -= 0.02;
                coinText.style.top = posY + "%";
                coinText.style.opacity = opacity;
                if (opacity <= 0) {
                    clearInterval(anim);
                    document.body.removeChild(coinText);
                }
            }, 30);
        }
    });

    socket.on('playerMapUpdate', (data) => {
        if (data.id === myId) {
            isSpectator = data.isSpectator;
            if (isSpectator) {
                // We died in a non-respawn mode
                document.getElementById('crosshair').style.display = 'none';
                document.getElementById('ui').style.display = 'none';
                document.getElementById('hotbar').style.display = 'none';
                document.getElementById('healthBarContainer').style.display = 'none';
                document.getElementById('spectatorOverlay').style.display = 'block';
                playerBody.velocity.set(0,0,0);
                // Move out of the way
                playerBody.position.set(0, 100, 0);
            }
        }
    });

    socket.on('playerRespawn', (data) => {
        if (data.id === myId) {
            health = data.health;
            document.getElementById('healthBar').style.width = '100%';
            document.getElementById('healthText').innerText = `${health} HP`;
            document.getElementById('lowHealthOverlay').style.boxShadow = 'inset 0 0 150px 50px rgba(255, 0, 0, 0)';

            // Teleport physics body
            playerBody.position.set(data.x, data.y, data.z);
            playerBody.velocity.set(0,0,0);

            // Lose weapons on death
            myWeapons = [];
            setMode('hands');
        }
    });
}

function spawnWeaponPickup(data) {
    if (weaponSpawnsLocal[data.id]) return; // Already exists

    const pickupGroup = new THREE.Group();
    pickupGroup.position.set(data.x, data.y, data.z);

    // Simple visual for now: a glowing rotating box colored by weapon type
    let color = 0xffffff;
    if (data.weaponType === 'ar') color = 0x00ffcc;
    if (data.weaponType === 'smg') color = 0xff00ff;
    if (data.weaponType === 'shotgun') color = 0xffaa00;
    if (data.weaponType === 'sniper') color = 0xff3333;
    if (data.weaponType === 'pistol') color = 0x00ccff;

    const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 1.5, wireframe: true });
    const mesh = new THREE.Mesh(geo, mat);

    // Inner solid core
    const coreMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.1 });
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), coreMat);
    pickupGroup.add(mesh, core);

    // Floating light
    const light = new THREE.PointLight(color, 1, 3);
    pickupGroup.add(light);

    pickupGroup.visible = data.active;
    scene.add(pickupGroup);

    weaponSpawnsLocal[data.id] = {
        mesh: pickupGroup,
        type: data.weaponType,
        active: data.active
    };
}


function init() {
    // --- THREE.JS SETUP ---
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky blue
    scene.fog = new THREE.Fog(0x87CEEB, 20, 100);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = window.location.search.includes('disable_ocean') ? THREE.PCFSoftShadowMap : THREE.VSMShadowMap; // VSM for buttery soft cinematic shadows (V12)
    renderer.toneMapping = THREE.ACESFilmicToneMapping; // ACES is brighter and cleaner for cartoonish looks
    renderer.toneMappingExposure = 0.9; // Lowered from 1.2 to reduce blinding glare
    document.body.appendChild(renderer.domElement);

    // --- POST-PROCESSING (BLOOM) ---
    // Use WebGLRenderTarget with MSAA to prevent jagged edges with post-processing
    const renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
        samples: 4, // 4x MSAA
        type: THREE.HalfFloatType // Better HDR precision
    });

    const renderScene = new RenderPass(scene, camera);

    // Antialiasing Pass using SMAA if available, but for now we rely on WebGLRenderTarget MSAA + standard FXAA/SSAA equivalents.
    // The renderer MSAA handles most of it.

    // SSAO Pass (Ambient Occlusion for shadows in corners, like 1v1.lol)
    const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
    ssaoPass.kernelRadius = 8; // Tighter kernel for more pronounced edge shadowing
    ssaoPass.minDistance = 0.001; // Tighter min distance for close contact shadows
    ssaoPass.maxDistance = 0.02; // Shorter max distance (prevents muddying flat surfaces)

    // Controlled bloom for neon glows without washing out sky
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.0, 0.4, 0.85);
    bloomPass.threshold = 0.95; // Higher threshold so only very bright things glow
    bloomPass.strength = 0.5; // Modest glow
    bloomPass.radius = 0.3;

    // FXAA Pass for smoothing out edges post-processing
    const fxaaPass = new ShaderPass(FXAAShader);
    const pixelRatio = renderer.getPixelRatio();
    fxaaPass.material.uniforms['resolution'].value.x = 1 / (window.innerWidth * pixelRatio);
    fxaaPass.material.uniforms['resolution'].value.y = 1 / (window.innerHeight * pixelRatio);

    // FilmPass (Graphics V15) - Adds subtle cinematic noise/scanlines
    const filmPass = new FilmPass(0.35, 0.025, 648, false);

    // Vignette Pass (Graphics V15) - Darkens corners
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms["offset"].value = 1.0;
    vignettePass.uniforms["darkness"].value = 1.2;

    const outputPass = new OutputPass();

    // Overshield post-processing pass (Graphics V17) - Simple color tint if health > 100
    const overshieldShader = {
        uniforms: {
            "tDiffuse": { value: null },
            "shieldIntensity": { value: 0.0 }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float shieldIntensity;
            varying vec2 vUv;
            void main() {
                vec4 texel = texture2D(tDiffuse, vUv);
                // Add cyan tint
                vec3 shieldColor = vec3(0.0, 0.8, 1.0);
                gl_FragColor = vec4(mix(texel.rgb, shieldColor, shieldIntensity), texel.a);
            }
        `
    };
    window.overshieldPass = new ShaderPass(overshieldShader);

    composer = new EffectComposer(renderer, renderTarget);
    composer.addPass(renderScene);
    composer.addPass(ssaoPass);
    composer.addPass(bloomPass);
    composer.addPass(fxaaPass);
    composer.addPass(window.overshieldPass);
    composer.addPass(filmPass);
    composer.addPass(vignettePass);
    composer.addPass(outputPass); // Applies tone mapping & color space conversion correctly

    // --- LIGHTS ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); // Higher ambient for a flatter, low-poly cartoon look
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0); // Extremely bright sun
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;

    // Cinematic VSM soft shadows
    dirLight.shadow.mapSize.width = window.location.search.includes('disable_ocean') ? 1024 : 4096; // 4K is plenty for VSM
    dirLight.shadow.mapSize.height = window.location.search.includes('disable_ocean') ? 1024 : 4096;
    dirLight.shadow.camera.top = 200;
    dirLight.shadow.camera.bottom = -200;
    dirLight.shadow.camera.left = -200;
    dirLight.shadow.camera.right = 200;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 1000;
    dirLight.shadow.bias = -0.0005; // Negative bias prevents peter-panning
    dirLight.shadow.radius = 8; // Blur radius for VSM
    dirLight.shadow.blurSamples = 25; // High samples for buttery smooth edges
    scene.add(dirLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4); // Subtle bounce light
    scene.add(hemiLight);

    // --- CANNON-ES SETUP ---
    world = new CANNON.World({
        gravity: new CANNON.Vec3(0, -9.82, 0), // m/s²
    });
    // Default material interactions
    defaultMaterial = new CANNON.Material('default');
    const defaultContactMaterial = new CANNON.ContactMaterial(defaultMaterial, defaultMaterial, {
        friction: 0.1,
        restitution: 0.0
    });
    world.addContactMaterial(defaultContactMaterial);

    // --- CONTROLS ---
    controls = new PointerLockControls(camera, document.body);

    // Track mouse movement for weapon sway
    document.addEventListener('mousemove', (event) => {
        const isWeaponMode = ['ar', 'smg', 'shotgun', 'sniper', 'pistol'].includes(currentMode);
        if (controls.isLocked && isWeaponMode) {
            // Add mouse delta to sway velocity
            gunSwayVelocity.x += event.movementX * 0.0005;
            gunSwayVelocity.y += event.movementY * 0.0005;

            // Clamp
            gunSwayVelocity.x = THREE.MathUtils.clamp(gunSwayVelocity.x, -0.05, 0.05);
            gunSwayVelocity.y = THREE.MathUtils.clamp(gunSwayVelocity.y, -0.05, 0.05);
        }
    });

    const instructions = document.getElementById('instructions');
    instructions.addEventListener('click', function () {
        controls.lock();
    });

    controls.addEventListener('lock', function () {
        instructions.style.display = 'none';
    });

    controls.addEventListener('unlock', function () {
        instructions.style.display = 'flex';
    });

    scene.add(controls.getObject());

    const onKeyDown = function (event) {
        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW':
                moveForward = true;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                moveLeft = true;
                break;
            case 'ArrowDown':
            case 'KeyS':
                moveBackward = true;
                break;
            case 'ArrowRight':
            case 'KeyD':
                moveRight = true;
                break;
            case 'Space':
                if (canJump === true) {
                    playerBody.velocity.y = jumpVelocity;
                }
                canJump = false;
                break;
            case 'ShiftLeft':
                isSprinting = true;
                break;
            case 'KeyC':
                if (!isCrouching) {
                    isCrouching = true;
                    if (isSprinting && (moveForward || moveLeft || moveRight || moveBackward) && canJump) {
                        isSliding = true;
                        slideTimer = 0.8; // Slide duration
                    }
                }
                break;
        }
    };

    const onKeyUp = function (event) {
        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW':
                moveForward = false;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                moveLeft = false;
                break;
            case 'ArrowDown':
            case 'KeyS':
                moveBackward = false;
                break;
            case 'ArrowRight':
            case 'KeyD':
                moveRight = false;
                break;
            case 'ShiftLeft':
                isSprinting = false;
                break;
            case 'KeyC':
                isCrouching = false;
                isSliding = false;
                break;
        }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    document.addEventListener('keyup', (event) => {
        if (event.code === 'Tab') {
            document.getElementById('leaderboard').style.display = 'none';
        }
    });

    // --- PLAYER PHYSICS ---
    const radius = 0.5;
    const playerShape = new CANNON.Sphere(radius);
    playerBody = new CANNON.Body({
        mass: 5,
        position: new CANNON.Vec3(0, 5, 0), // Start above ground
        shape: playerShape,
        material: defaultMaterial,
        fixedRotation: true // Keep player from falling over
    });
    playerBody.linearDamping = 0.9; // Add some friction to movement
    world.addBody(playerBody);

    // Jump & Fall Damage logic detection
    canJump = false;
    let wasGrounded = false;
    let previousVerticalVelocity = 0;

    let contactNormal = new CANNON.Vec3(); // Normal in the contact, pointing *out* of whatever the player touched
    let upAxis = new CANNON.Vec3(0, 1, 0);
    playerBody.addEventListener("collide", function(e){
        let contact = e.contact;

        // contact.bi and contact.bj are the colliding bodies, and contact.ni is the collision normal.
        // We do not yet know which one is which! Let's check.
        if(contact.bi.id == playerBody.id) {
            contact.ni.negate(contactNormal);
        } else {
            contactNormal.copy(contact.ni); // bi is something else. Keep the normal as it is
        }

        // Check if we hit a bouncer
        let otherBody = contact.bi.id == playerBody.id ? contact.bj : contact.bi;
        if (otherBody.userData && otherBody.userData.type === 'bouncer' && contactNormal.dot(upAxis) > 0.5) {
            // Apply massive upward velocity
            playerBody.velocity.y = 25.0;
            canJump = false; // Prevents jumping again mid-air
            return;
        }

        // If contactNormal.dot(upAxis) is between 0 and 1, we know that the contact normal is somewhat in the up direction.
        if(contactNormal.dot(upAxis) > 0.5) { // Use a "non-strict" equality here (e.g., > 0.5) to allow jumping on ramps.
            canJump = true;

            // Fall Damage Calculation
            if (!wasGrounded && previousVerticalVelocity < -15) {
                // Calculate damage based on speed (e.g., -15 is safe, -25 is lethal)
                const fallDamage = Math.floor(Math.pow(Math.abs(previousVerticalVelocity) - 15, 1.8));
                if (fallDamage > 0 && !isSpectator) {
                    // Trigger massive screen shake on hard landing
                    screenShakeIntensity = Math.min(0.5, fallDamage * 0.01);
                    if (socket) {
                        // Apply damage to self
                        socket.emit('playerHit', { targetId: myId, damage: fallDamage });
                    }
                }
            }
        }
    });

    // We defer resetting canJump to allow it to be true during jump key processing.
    // However, if we don't have active collisions in the preStep, we should assume we're not grounded.
    world.addEventListener('preStep', () => {
        wasGrounded = canJump; // Remember state before we reset it
        previousVerticalVelocity = playerBody.velocity.y; // Record velocity before physics resolves collision
        canJump = false;
    });

    // Crouch physics update
    world.addEventListener('postStep', () => {
        if (playerBody) {
            // Adjust hit sphere shape when crouching/sliding
            const targetRadius = isCrouching ? 0.25 : 0.5;
            if (playerBody.shapes[0].radius !== targetRadius) {
                playerBody.shapes[0].radius = targetRadius;
                playerBody.shapes[0].updateBoundingSphereRadius();
            }
        }
    });

    // --- WEAPONS SYSTEM ---
    gunMesh = new THREE.Group();

    // Apply Weapon Skin colors
    let wColor = 0x2A2A30; // default grey
    const foundWSkin = weaponSkins.find(s => s.id === equippedWeaponSkin);
    if (foundWSkin) wColor = foundWSkin.color;

    // Materials (Enhanced V9 + Skins)
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x111115, roughness: 0.2, metalness: 0.9, flatShading: true });
    const greyPolymer = new THREE.MeshStandardMaterial({ color: wColor, roughness: 0.6, metalness: 0.4, flatShading: true });

    // Create AR Mesh
    const arMesh = new THREE.Group();
    arMesh.name = "ar";
    const arNeonMat = new THREE.MeshStandardMaterial({ color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 2.5 });
    const arReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.45), darkMetal); arReceiver.position.set(0, 0, 0.05);
    const arBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 16), darkMetal); arBarrel.rotation.x = Math.PI / 2; arBarrel.position.set(0, 0.02, -0.4);
    const arHandguard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.35), greyPolymer); arHandguard.position.set(0, 0, -0.3);
    const arStock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.3), greyPolymer); arStock.position.set(0, -0.05, 0.4);
    const arMag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.1), greyPolymer); arMag.rotation.x = -Math.PI / 16; arMag.position.set(0, -0.15, 0);
    const arGrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.08), greyPolymer); arGrip.rotation.x = Math.PI / 16; arGrip.position.set(0, -0.12, 0.15);
    const arRail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.3), arNeonMat); arRail.position.set(0, 0.06, -0.3);
    const arSightGlass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), new THREE.MeshStandardMaterial({color: 0x00ffcc, transparent: true, opacity: 0.4, emissive: 0x00ffcc, emissiveIntensity: 0.5, side: THREE.DoubleSide})); arSightGlass.position.set(0, 0.15, 0.05);
    const arHoloDot = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), new THREE.MeshBasicMaterial({color: 0xff0000})); arHoloDot.position.set(0, 0.15, 0.04);
    // Added details: Side rails, charging handle, muzzle brake
    const arMuzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), darkMetal); arMuzzle.rotation.x = Math.PI/2; arMuzzle.position.set(0, 0.02, -0.72);
    const arSideRailL = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.25), darkMetal); arSideRailL.position.set(-0.045, 0, -0.3);
    const arSideRailR = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.25), darkMetal); arSideRailR.position.set(0.045, 0, -0.3);
    arMesh.add(arReceiver, arBarrel, arHandguard, arStock, arMag, arGrip, arRail, arSightGlass, arHoloDot, arMuzzle, arSideRailL, arSideRailR);

    // Create SMG Mesh (Compact, faster)
    const smgMesh = new THREE.Group();
    smgMesh.name = "smg";
    const smgNeonMat = new THREE.MeshStandardMaterial({ color: 0xff00cc, emissive: 0xff00cc, emissiveIntensity: 2.5 });
    const smgReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.3), darkMetal); smgReceiver.position.set(0, 0, 0);
    const smgBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 16), darkMetal); smgBarrel.rotation.x = Math.PI / 2; smgBarrel.position.set(0, 0, -0.25);
    const smgStock = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.2), darkMetal); smgStock.position.set(0, 0, 0.25);
    const smgMag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.25, 0.08), greyPolymer); smgMag.position.set(0, -0.15, -0.05); // Straight mag
    const smgGrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06), greyPolymer); smgGrip.rotation.x = Math.PI / 16; smgGrip.position.set(0, -0.1, 0.1);
    const smgRail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.2), smgNeonMat); smgRail.position.set(0, 0.05, -0.2);
    smgMesh.add(smgReceiver, smgBarrel, smgStock, smgMag, smgGrip, smgRail);

    // Create Shotgun Mesh (Wide barrel, pump action)
    const sgMesh = new THREE.Group();
    sgMesh.name = "shotgun";
    const sgNeonMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 2.5 });
    const sgReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.4), darkMetal); sgReceiver.position.set(0, 0, 0.05);
    const sgBarrel1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 16), darkMetal); sgBarrel1.rotation.x = Math.PI / 2; sgBarrel1.position.set(-0.02, 0.02, -0.35);
    const sgBarrel2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 16), darkMetal); sgBarrel2.rotation.x = Math.PI / 2; sgBarrel2.position.set(0.02, 0.02, -0.35); // Double barrel look
    const sgStock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.25), greyPolymer); sgStock.position.set(0, -0.05, 0.35);
    const sgGrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.1), greyPolymer); sgGrip.rotation.x = Math.PI / 16; sgGrip.position.set(0, -0.1, 0.15);
    const sgRail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.1), sgNeonMat); sgRail.position.set(0, 0.05, 0);
    sgMesh.add(sgReceiver, sgBarrel1, sgBarrel2, sgStock, sgGrip, sgRail);

    // Create Sniper Mesh (Long barrel, scope)
    const sniperMesh = new THREE.Group();
    sniperMesh.name = "sniper";
    const snipNeonMat = new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 2.5 });
    const snipReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.5), darkMetal); snipReceiver.position.set(0, 0, 0.1);
    const snipBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 16), darkMetal); snipBarrel.rotation.x = Math.PI / 2; snipBarrel.position.set(0, 0.02, -0.6);
    const snipScope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 16), darkMetal); snipScope.rotation.x = Math.PI / 2; snipScope.position.set(0, 0.15, 0);
    const snipScopeMount1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), darkMetal); snipScopeMount1.position.set(0, 0.1, 0.1);
    const snipScopeMount2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), darkMetal); snipScopeMount2.position.set(0, 0.1, -0.1);
    const snipStock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.3), greyPolymer); snipStock.position.set(0, -0.03, 0.5);
    const snipStockPad = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.05), new THREE.MeshStandardMaterial({color: 0x050505})); snipStockPad.position.set(0, -0.03, 0.65);
    const snipMag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.08), greyPolymer); snipMag.position.set(0, -0.12, 0.1);
    const snipGrip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.06), greyPolymer); snipGrip.rotation.x = Math.PI / 16; snipGrip.position.set(0, -0.1, 0.25);
    const snipRail = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.4), snipNeonMat); snipRail.position.set(0, 0.06, -0.3);
    const snipMuzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.15, 8), darkMetal); snipMuzzle.rotation.x = Math.PI/2; snipMuzzle.position.set(0, 0.02, -1.1);
    const snipLens = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 16), new THREE.MeshStandardMaterial({color: 0x88ccff, transparent: true, opacity: 0.8, emissive: 0x88ccff, emissiveIntensity: 1.0})); snipLens.rotation.x = Math.PI/2; snipLens.position.set(0, 0.15, -0.15);
    sniperMesh.add(snipReceiver, snipBarrel, snipScope, snipScopeMount1, snipScopeMount2, snipStock, snipStockPad, snipMag, snipGrip, snipRail, snipMuzzle, snipLens);

    // Create Pistol Mesh (Small)
    const pistolMesh = new THREE.Group();
    pistolMesh.name = "pistol";
    const pistNeonMat = new THREE.MeshStandardMaterial({ color: 0x00ccff, emissive: 0x00ccff, emissiveIntensity: 2.5 });
    const pistReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.25), darkMetal); pistReceiver.position.set(0, 0, -0.05);
    const pistGrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.08), greyPolymer); pistGrip.rotation.x = Math.PI / 16; pistGrip.position.set(0, -0.08, 0.05);
    const pistBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.1), darkMetal); pistBarrel.position.set(0, 0.02, -0.2);
    const pistRail = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.15), pistNeonMat); pistRail.position.set(0, 0.05, -0.1);
    const pistSlide = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.04, 0.25), greyPolymer); pistSlide.position.set(0, 0.05, -0.05);
    const pistSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), pistNeonMat); pistSight.position.set(0, 0.07, -0.15);
    const pistLaser = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.1, 8), new THREE.MeshBasicMaterial({color: 0xff0000})); pistLaser.rotation.x = Math.PI/2; pistLaser.position.set(0, -0.02, -0.15);
    pistolMesh.add(pistReceiver, pistGrip, pistBarrel, pistRail, pistSlide, pistSight, pistLaser);

    // Muzzle Flash Visuals (V11)
    const flashGroup = new THREE.Group();
    flashGroup.position.set(0, 0.02, -0.75);
    flashGroup.name = "muzzleFlash";
    const flashLight = new THREE.PointLight(0xffaa00, 0, 5);
    flashGroup.add(flashLight);

    // Starburst geometry
    const burstGeo = new THREE.PlaneGeometry(0.3, 0.3);
    const burstMat = new THREE.MeshBasicMaterial({
        color: 0xffdd88, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false, map: null // Would ideally be a texture
    });
    const burst1 = new THREE.Mesh(burstGeo, burstMat); burst1.rotation.y = Math.PI/2;
    const burst2 = new THREE.Mesh(burstGeo, burstMat); burst2.rotation.y = Math.PI/2; burst2.rotation.x = Math.PI/4;
    const burst3 = new THREE.Mesh(burstGeo, burstMat); burst3.rotation.y = Math.PI/2; burst3.rotation.x = -Math.PI/4;
    flashGroup.add(burst1, burst2, burst3);

    gunMesh.add(arMesh);
    gunMesh.add(smgMesh);
    gunMesh.add(sgMesh);
    gunMesh.add(sniperMesh);
    gunMesh.add(pistolMesh);
    gunMesh.add(flashGroup);

    // Default to empty hands (no weapon) initially
    arMesh.visible = false;
    smgMesh.visible = false;
    sgMesh.visible = false;
    sniperMesh.visible = false;
    pistolMesh.visible = false;

    // Position relative to camera
    gunMesh.position.copy(baseGunPosition);
    camera.add(gunMesh);
    scene.add(camera); // Camera needs to be in scene for children to render

    // --- SKY & LIGHTING (Stylized / Non-Blinding) ---
    // Pushing the colors closer to 1v1.lol's hyper-vibrant aesthetic
    let skyColor = 0x66CCFF; // Very bright cyan-sky blue
    let groundColor = 0x4CE659; // Vivid lime/sea green
    let groundSize = 200;
    let fogColor = 0x66CCFF;
    let fogDensity = 0.0005; // Extremely minimal fog for long draw distances

    if (currentMap === 'island') {
        groundColor = 0xFFD27F; // Warm vibrant sand
        groundSize = 150;
        skyColor = 0x33BBFF; // Strong sky blue
        fogColor = 0x33BBFF;
        fogDensity = 0.0005;
    } else if (currentMap === 'br_island') {
        groundColor = 0xFFD27F; // Warm vibrant sand
        groundSize = 800; // Massive
        skyColor = 0x33BBFF; // Strong sky blue
        fogColor = 0x33BBFF;
        fogDensity = 0.0005;
    } else if (currentMap === 'platform') {
        groundColor = 0x404040; // Slate gray
        groundSize = 80;
        skyColor = 0x0A0A2A; // Deep night sky
        fogColor = 0x0A0A2A;
        fogDensity = 0.002;
    } else if (currentMap === 'city') {
        groundColor = 0x8C8C8C; // Light concrete
        groundSize = 300;
        skyColor = 0x99D6FF; // Pale morning blue
        fogColor = 0x99D6FF;
        fogDensity = 0.0005;
    } else if (currentMap === 'desert') {
        groundColor = 0xE6C280; // Desert dune sand
        groundSize = 250;
        skyColor = 0x55CCFF; // Hot desert sky
        fogColor = 0xE6C280; // Dust storm fog
        fogDensity = 0.001;
    } else if (currentMap === 'space') {
        groundColor = 0x111122; // Dark space metal
        groundSize = 150;
        skyColor = 0x000005; // Pitch black space
        fogColor = 0x000005;
        fogDensity = 0.003;
    } else if (currentMap === 'lava') {
        groundColor = 0xCC2200; // Glowing lava red
        groundSize = 150;
        skyColor = 0x220000; // Dark red hellish sky
        fogColor = 0x440000;
        fogDensity = 0.002;
    } else if (currentMap === 'snow') {
        groundColor = 0xE0F0FF; // Ice white
        groundSize = 300;
        skyColor = 0xAACCFF; // Pale blue winter sky
        fogColor = 0xEEEEFF;
        fogDensity = 0.01;
    } else if (currentMap === 'forest') {
        groundColor = 0x2E5B2C; // Deep forest green
        groundSize = 300;
        skyColor = 0x87CEEB; // Clear sky
        fogColor = 0x88AA88; // Slight green haze
        fogDensity = 0.004;
    } else if (currentMap === 'cyber_city') {
        groundColor = 0x111115; // Dark asphalt
        groundSize = 200;
        skyColor = 0x050011; // Dark neon sky
        fogColor = 0x220033;
        fogDensity = 0.005;
    } else if (currentMap === 'moon_base') {
        groundColor = 0x666666; // Grey moon dust
        groundSize = 300;
        skyColor = 0x000000; // Space
        fogColor = 0x000000;
        fogDensity = 0.002;
    } else if (currentMap === 'canyon') {
        groundColor = 0xAA4422; // Red rock
        groundSize = 400;
        skyColor = 0xFF8844; // Dusty sunset
        fogColor = 0xFF8844;
        fogDensity = 0.005;
    } else if (currentMap === 'neon_city') {
        groundColor = 0x1A053A; // Deep synthwave purple
        groundSize = 250;
        skyColor = 0x2A004A; // Purple sky
        fogColor = 0xFF00FF; // Magenta fog
        fogDensity = 0.008;
    }

    scene.background = new THREE.Color(skyColor);
    scene.fog = new THREE.FogExp2(fogColor, fogDensity);

    // Dynamic Sky System (Graphics V9)
    if (currentMap !== 'space' && currentMap !== 'platform' && currentMap !== 'lava') {
        const sky = new Sky();
        sky.scale.setScalar(450000);

        // Save references for animation
        globalSky = sky;
        globalDirLight = dirLight;

        // Function to update sun based on timeOfDay (Hours 0-24)
        const updateSun = () => {
            const phi = THREE.MathUtils.degToRad(90 - (timeOfDay - 6) * 15); // Elevation
            const theta = THREE.MathUtils.degToRad(180); // Azimuth
            const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

            sky.material.uniforms['sunPosition'].value.copy(sunPosition);

            // Adjust scattering to match map vibe
            if (currentMap === 'desert') {
                sky.material.uniforms['turbidity'].value = 10;
                sky.material.uniforms['rayleigh'].value = 3;
                sky.material.uniforms['mieCoefficient'].value = 0.05;
                sky.material.uniforms['mieDirectionalG'].value = 0.8;
            } else {
                sky.material.uniforms['turbidity'].value = 2; // Crisp air
                sky.material.uniforms['rayleigh'].value = 1;
                sky.material.uniforms['mieCoefficient'].value = 0.005;
                sky.material.uniforms['mieDirectionalG'].value = 0.8;
            }

            // Sun light to match sky sun
            dirLight.position.copy(sunPosition).multiplyScalar(100);

            // Intensity peaks at noon, drops to 0 at night
            const sunHeight = Math.max(0, Math.sin(THREE.MathUtils.degToRad((timeOfDay - 6) * 15)));
            dirLight.intensity = 1.5 * sunHeight;

            // PBR Reflections (Graphics V11) - Generate environment map from the Sky
            if (!window.location.search.includes('disable_ocean')) {
                try {
                    const pmremGenerator = new THREE.PMREMGenerator(renderer);
                    pmremGenerator.compileEquirectangularShader();
                    const renderTarget = pmremGenerator.fromScene(scene);
                    scene.environment = renderTarget.texture;
                    pmremGenerator.dispose();
                } catch(e) { console.warn(e); }
            }
        };

        updateSun(); // Initial call
        scene.add(sky);
    }

    // If space, add stars
    if (currentMap === 'space') {
        const starGeo = new THREE.BufferGeometry();
        const starCount = 2000;
        const starPos = new Float32Array(starCount * 3);
        for(let i=0; i<starCount*3; i++) {
            starPos[i] = (Math.random() - 0.5) * 500;
        }
        starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({color: 0xffffff, size: 0.7});
        const stars = new THREE.Points(starGeo, starMat);
        scene.add(stars);
    } else {
        // Atmospheric Dust Particles for other maps
        const dustGeo = new THREE.BufferGeometry();
        const dustCount = 1000;
        const dustPos = new Float32Array(dustCount * 3);
        for(let i=0; i<dustCount*3; i++) {
            dustPos[i] = (Math.random() - 0.5) * 200; // Spread across map
        }
        dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));

        let dustColor = 0xffffff;
        if (currentMap === 'desert') dustColor = 0xE6C280;
        if (currentMap === 'lava') dustColor = 0xFF5500;
        if (currentMap === 'snow') dustColor = 0xFFFFFF; // Snowflakes
        if (currentMap === 'forest' || currentMap === 'br_island') dustColor = 0x88CC88; // Leaves/pollen
        if (currentMap === 'cyber_city') dustColor = 0x00ffcc; // Neon rain
        if (currentMap === 'moon_base') dustColor = 0xaaaaaa; // Moon dust
        if (currentMap === 'canyon') dustColor = 0xFF8844; // Sand
        if (currentMap === 'neon_city') dustColor = 0xff00ff; // Neon specks

        const dustMat = new THREE.PointsMaterial({
            color: dustColor,
            size: 0.3,
            transparent: true,
            opacity: 0.4,
            depthWrite: false
        });
        dustParticles = new THREE.Points(dustGeo, dustMat);
        dustParticles.position.y = 20; // Float slightly up
        scene.add(dustParticles);
    }

    // Sync lights to match the mood
    if (currentMap === 'space' || currentMap === 'lava') {
        dirLight.position.set(80, 150, 60);
        dirLight.intensity = 0.8;
    }
    if (currentMap === 'lava') dirLight.color.setHex(0xffaa55);

    // Only nullify environment if we aren't using the dynamic sky
    if (['space', 'platform', 'lava', 'cyber_city', 'moon_base', 'neon_city'].includes(currentMap)) {
        scene.environment = null;
    }
    hemiLight.color.setHex(skyColor);
    hemiLight.groundColor.setHex(groundColor);
    hemiLight.intensity = (currentMap === 'space' || currentMap === 'lava') ? 0.3 : 0.9;

    // --- PROCEDURAL GROUND TEXTURES VIA CANVAS ---
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = 512;
    groundCanvas.height = 512;
    const gctx = groundCanvas.getContext('2d');

    // Fill base background
    gctx.fillStyle = '#' + groundColor.toString(16).padStart(6, '0');
    gctx.fillRect(0, 0, 512, 512);

    // Procedural Detail based on map type
    if (currentMap === 'classic') {
        // Bright neon grass grid
        gctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        gctx.lineWidth = 2;
        gctx.strokeRect(0, 0, 512, 512);
        gctx.beginPath(); gctx.moveTo(256, 0); gctx.lineTo(256, 512); gctx.moveTo(0, 256); gctx.lineTo(512, 256); gctx.stroke();
        gctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        gctx.beginPath(); gctx.arc(256, 256, 12, 0, Math.PI*2); gctx.fill();

        // Add subtle grass blades
        for(let i=0; i<300; i++) {
            gctx.fillStyle = Math.random() > 0.5 ? '#3CB343' : '#57E864';
            gctx.fillRect(Math.random()*512, Math.random()*512, 4, 15 + Math.random()*15);
        }
    } else if (currentMap === 'island' || currentMap === 'desert' || currentMap === 'br_island') {
        // Sand texture with speckles and wavy dunes
        for(let i=0; i<1000; i++) {
            gctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)';
            gctx.fillRect(Math.random()*512, Math.random()*512, 2, 2);
        }
        // Dune lines
        gctx.strokeStyle = 'rgba(0,0,0,0.03)';
        gctx.lineWidth = 20;
        for(let y=0; y<512; y+=80) {
            gctx.beginPath(); gctx.moveTo(0, y); gctx.bezierCurveTo(128, y+30, 384, y-30, 512, y); gctx.stroke();
        }
    } else if (currentMap === 'city' || currentMap === 'platform') {
        // Concrete/Asphalt texture
        for(let i=0; i<2000; i++) {
            gctx.fillStyle = `rgba(0,0,0,${Math.random()*0.1})`;
            gctx.fillRect(Math.random()*512, Math.random()*512, 3, 3);
        }
        // Grid lines for scale
        gctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        gctx.lineWidth = 4;
        gctx.strokeRect(0, 0, 512, 512);
    } else if (currentMap === 'space') {
        // Metallic sci-fi panels
        gctx.fillStyle = '#1a1a2e'; gctx.fillRect(0,0,512,512);
        gctx.strokeStyle = '#00ffcc'; gctx.lineWidth = 4;
        gctx.strokeRect(10, 10, 492, 492);
        gctx.fillStyle = 'rgba(0,255,204,0.1)';
        gctx.fillRect(10, 10, 492, 492);
        // Sci-fi vents
        gctx.fillStyle = '#0f0f1a';
        for(let i=40; i<480; i+=60) { gctx.fillRect(i, 40, 20, 100); }
    } else if (currentMap === 'lava') {
        // Lava crust and glowing cracks
        gctx.fillStyle = '#CC2200'; gctx.fillRect(0,0,512,512); // Base bright lava
        // Dark crust
        for(let i=0; i<50; i++) {
            gctx.fillStyle = '#220000';
            gctx.beginPath(); gctx.arc(Math.random()*512, Math.random()*512, 20+Math.random()*50, 0, Math.PI*2); gctx.fill();
        }
        // Glowing cracks
        gctx.strokeStyle = '#FFaa00'; gctx.lineWidth = 3; gctx.shadowBlur = 10; gctx.shadowColor = '#FFaa00';
        for(let i=0; i<5; i++) {
            gctx.beginPath(); gctx.moveTo(Math.random()*512, 0); gctx.lineTo(Math.random()*512, 256); gctx.lineTo(Math.random()*512, 512); gctx.stroke();
        }
        gctx.shadowBlur = 0; // reset
    } else if (currentMap === 'snow') {
        gctx.fillStyle = '#E0F0FF'; gctx.fillRect(0,0,512,512);
        // Ice patches
        for(let i=0; i<300; i++) {
            gctx.fillStyle = 'rgba(255,255,255,0.8)';
            gctx.fillRect(Math.random()*512, Math.random()*512, 10, 10);
        }
    } else if (currentMap === 'forest') {
        gctx.fillStyle = '#2E5B2C'; gctx.fillRect(0,0,512,512);
        // Dirt patches and grass blades
        for(let i=0; i<500; i++) {
            gctx.fillStyle = Math.random() > 0.5 ? '#3B7038' : '#453521'; // Grass or dirt
            gctx.beginPath(); gctx.arc(Math.random()*512, Math.random()*512, 5+Math.random()*15, 0, Math.PI*2); gctx.fill();
        }
    } else if (currentMap === 'cyber_city') {
        gctx.fillStyle = '#111115'; gctx.fillRect(0,0,512,512);
        gctx.strokeStyle = '#ff00ff'; gctx.lineWidth = 2; gctx.shadowBlur = 10; gctx.shadowColor = '#00ffcc';
        for(let i=0; i<512; i+=64) {
            gctx.strokeRect(i, 0, 64, 512);
            gctx.strokeRect(0, i, 512, 64);
        }
        gctx.shadowBlur = 0;
    } else if (currentMap === 'moon_base') {
        gctx.fillStyle = '#666666'; gctx.fillRect(0,0,512,512);
        gctx.fillStyle = '#444444';
        for(let i=0; i<50; i++) {
            gctx.beginPath(); gctx.arc(Math.random()*512, Math.random()*512, 5+Math.random()*20, 0, Math.PI*2); gctx.fill();
        }
    } else if (currentMap === 'canyon') {
        gctx.fillStyle = '#AA4422'; gctx.fillRect(0,0,512,512);
        gctx.strokeStyle = '#882211'; gctx.lineWidth = 15;
        for(let y=0; y<512; y+=40) {
            gctx.beginPath(); gctx.moveTo(0, y); gctx.lineTo(512, y); gctx.stroke();
        }
    } else if (currentMap === 'neon_city') {
        gctx.fillStyle = '#1A053A'; gctx.fillRect(0,0,512,512);
        gctx.strokeStyle = 'rgba(0, 255, 255, 0.4)'; gctx.lineWidth = 2;
        gctx.strokeRect(0,0,512,512);
        gctx.strokeStyle = 'rgba(255, 0, 255, 0.3)';
        gctx.beginPath(); gctx.moveTo(0, 0); gctx.lineTo(512, 512); gctx.stroke();
    }

    const groundTex = new THREE.CanvasTexture(groundCanvas);
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(groundSize / GRID_SIZE, groundSize / GRID_SIZE);
    groundTex.magFilter = THREE.NearestFilter;
    groundTex.minFilter = THREE.NearestMipmapLinearFilter;

    // Procedural PBR Roughness/Metalness Map (V11)
    // We'll create a dedicated texture to map specular reflections realistically.
    const pbrCanvas = document.createElement('canvas');
    pbrCanvas.width = 512; pbrCanvas.height = 512;
    const pbrCtx = pbrCanvas.getContext('2d');

    // Default: rough
    pbrCtx.fillStyle = '#FFFFFF'; // White = 1.0 roughness
    pbrCtx.fillRect(0,0,512,512);

    if (currentMap === 'city' || currentMap === 'platform') {
        // Concrete with wet shiny puddles
        for(let i=0; i<30; i++) {
            pbrCtx.fillStyle = '#111111'; // Black = 0 roughness (very shiny)
            pbrCtx.beginPath();
            pbrCtx.ellipse(Math.random()*512, Math.random()*512, 20+Math.random()*50, 10+Math.random()*30, Math.random()*Math.PI, 0, Math.PI*2);
            pbrCtx.fill();
        }
    } else if (currentMap === 'lava') {
        // Glowing lava is smooth (shiny), crust is rough
        pbrCtx.fillStyle = '#111111'; // Shiny magma
        pbrCtx.fillRect(0,0,512,512);
        for(let i=0; i<50; i++) {
            pbrCtx.fillStyle = '#FFFFFF'; // Rough crust
            pbrCtx.beginPath(); pbrCtx.arc(Math.random()*512, Math.random()*512, 20+Math.random()*50, 0, Math.PI*2); pbrCtx.fill();
        }
    } else if (currentMap === 'space') {
        // Metal is generally smooth
        pbrCtx.fillStyle = '#444444';
        pbrCtx.fillRect(0,0,512,512);
    }

    const roughnessTex = new THREE.CanvasTexture(pbrCanvas);
    roughnessTex.wrapS = THREE.RepeatWrapping; roughnessTex.wrapT = THREE.RepeatWrapping;
    roughnessTex.repeat.set(groundSize / GRID_SIZE, groundSize / GRID_SIZE);

    // Topography generation (Graphics V10)
    // We use a high-segment plane to allow vertex displacement
    const segments = 64;
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, segments, segments);
    groundGeo.rotateX(-Math.PI / 2); // Rotate to lay flat before displacing Y

    const vertices = groundGeo.attributes.position.array;
    for (let i = 0; i < vertices.length; i += 3) {
        const x = vertices[i];
        const z = vertices[i+2];
        let y = 0;

        // Keep the center (spawn area) relatively flat
        const distFromCenter = Math.sqrt(x*x + z*z);
        const flattenFactor = Math.min(1, Math.max(0, (distFromCenter - 20) / 30));

        if (currentMap === 'island' || currentMap === 'desert') {
            // Rolling dunes
            y = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 5;
            y += Math.sin(x * 0.1) * 2;
        } else if (currentMap === 'br_island') {
            // Larger hills and valleys
            y = Math.sin(x * 0.02) * Math.cos(z * 0.02) * 15;
            y += Math.sin(x * 0.05) * 5;
        } else if (currentMap === 'lava') {
            // Jagged rocks and sunken lava pits
            y = Math.sin(x * 0.1) * Math.sin(z * 0.1) * 3;
            if (y < 0) y *= 2; // Deeper pits
        } else if (currentMap === 'snow') {
            // Gentle snowdrifts
            y = Math.sin(x * 0.03) * Math.cos(z * 0.03) * 3;
        } else if (currentMap === 'forest') {
            // Hilly uneven ground
            y = Math.sin(x * 0.08) * Math.cos(z * 0.06) * 4;
            y += Math.sin(x * 0.2) * 1;
        } else if (currentMap === 'moon_base') {
            // Craters (inverted bumps)
            y = Math.sin(x * 0.1) * Math.sin(z * 0.1) * 3;
            if (y > 0) y *= 0.5; // Flatten the peaks, keep the craters deep
        } else if (currentMap === 'canyon') {
            // Deep ravines
            y = Math.sin(x * 0.05) * 10;
            if (y > 5) y = 5; // Flat top mesas
        }

        vertices[i+1] = y * flattenFactor;
    }
    groundGeo.computeVertexNormals(); // Recalculate normals for lighting

    // Adjust material properties based on map
    const groundMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: groundTex,
        bumpMap: groundTex,
        bumpScale: currentMap === 'lava' ? 0.2 : 0.02,
        roughnessMap: roughnessTex,
        roughness: 1.0,
        metalness: currentMap === 'space' ? 0.8 : 0.1, // Little base metalness so puddles reflect sky
        flatShading: true,
        emissive: currentMap === 'lava' ? 0x661100 : 0x000000,
        emissiveMap: currentMap === 'lava' ? groundTex : null
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
    activeGroundMesh = groundMesh; // Save reference for animation

    // Cannon-es Ground (Trimesh for accurate collision with topography)
    // Create a Trimesh physics body matching the displaced geometry exactly
    // CANNON.Trimesh requires a flat array of positions, and a flat array of indices
    // BufferGeometry may not have an index array by default if it's non-indexed
    let indices = groundGeo.index ? groundGeo.index.array : [];
    if (!groundGeo.index) {
        // Generate indices for a non-indexed plane
        indices = [];
        for (let i = 0; i < vertices.length / 3 - segments - 2; i++) {
            indices.push(i, i+1, i+segments+1);
            indices.push(i+1, i+segments+2, i+segments+1);
        }
    }

    const trimeshShape = new CANNON.Trimesh(groundGeo.attributes.position.array, indices);
    const groundBody = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: trimeshShape,
        material: defaultMaterial,
        position: new CANNON.Vec3(0, 0, 0)
    });
    world.addBody(groundBody);

    // Stylized Ocean for Island map (Graphics V12)
    if (currentMap === 'island' || currentMap === 'br_island') {
        const oceanSize = currentMap === 'br_island' ? 1200 : 250; // Much smaller ocean size to avoid massive CPU overhead in JS and playwright
        const oceanSegs = 16; // Fewer segments for performance
        const oceanGeo = new THREE.PlaneGeometry(oceanSize, oceanSize, oceanSegs, oceanSegs);
        oceanGeo.rotateX(-Math.PI / 2);

        const oceanMat = new THREE.MeshStandardMaterial({
            color: 0x006699, roughness: 0.1, metalness: 0.8,
            transparent: true, opacity: 0.8, flatShading: true
        });
        oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
        oceanMesh.position.y = -5; // Sink below the island
        oceanMesh.receiveShadow = true;
        scene.add(oceanMesh);
    }

    // Death plane for falling off
    world.addEventListener('postStep', () => {
        if (playerBody.position.y < -20) {
            // Force respawn
            health = 0;
            if (socket) {
                socket.emit('playerHit', { targetId: myId, damage: 1000 });
            }
        }
    });

    // --- GHOST MESH SETUP ---
    // Pre-create geometries to avoid memory leaks
    const wallGeo = new THREE.BoxGeometry(GRID_SIZE, GRID_SIZE, 0.5);
    const floorGeo = new THREE.BoxGeometry(GRID_SIZE, 0.5, GRID_SIZE);

    // Store them so updateGhostPlacement can just swap them
    ghostMaterial.userData = { wallGeo, floorGeo };

    // Ramp needs custom shape
    const rampShape = new THREE.Shape();
    rampShape.moveTo(0, 0);
    rampShape.lineTo(GRID_SIZE, GRID_SIZE);
    rampShape.lineTo(GRID_SIZE, 0);
    rampShape.lineTo(0, 0);
    const extrudeSettings = { depth: GRID_SIZE, bevelEnabled: false };
    const rampGeo = new THREE.ExtrudeGeometry(rampShape, extrudeSettings);
    rampGeo.translate(-GRID_SIZE/2, -GRID_SIZE/2, -GRID_SIZE/2); // Center it

    ghostMesh = new THREE.Mesh(wallGeo, ghostMaterial);
    scene.add(ghostMesh);
    ghostMesh.visible = false; // Hide initially (weapon mode)

    ghostRampMesh = new THREE.Mesh(rampGeo, ghostMaterial);
    scene.add(ghostRampMesh);
    ghostRampMesh.visible = false;

    // --- INPUT HANDLING (Modes & Build) ---
    document.addEventListener('keydown', (event) => {
        if (!controls.isLocked && event.code !== 'Tab') return;

        if (event.code === 'Tab') {
            event.preventDefault();
            document.getElementById('leaderboard').style.display = 'block';
            return;
        }

        // Mode switching
        switch(event.code) {
            case 'Digit1': if(myWeapons.includes('ar')) setMode('ar'); break;
            case 'Digit2': if(myWeapons.includes('smg')) setMode('smg'); break;
            case 'Digit3': if(myWeapons.includes('shotgun')) setMode('shotgun'); break;
            case 'Digit8': if(myWeapons.includes('sniper')) setMode('sniper'); break;
            case 'Digit9': if(myWeapons.includes('pistol')) setMode('pistol'); break;
            case 'Digit4': setMode('wall'); break;
            case 'Digit5': setMode('floor'); break;
            case 'Digit6': setMode('ramp'); break;
            case 'Digit7': setMode('heal'); break;
            case 'KeyE': interactWithPickup(); break;
            case 'KeyB': triggerEmote(); break;
            case 'KeyR': reloadWeapon(); break;
            case 'KeyG': editBuilding(); break;
        }
    });

    document.addEventListener('mousedown', (event) => {
        if (!controls.isLocked) return;

        const isWeapon = ['ar', 'smg', 'shotgun', 'sniper', 'pistol'].includes(currentMode);

        if (event.button === 0) { // Left click
            if (currentMode === 'heal') {
                useHeal();
            } else if (!isWeapon && (ghostMesh.visible || ghostRampMesh.visible)) {
                placeBuilding();
            } else if (isWeapon) {
                isShooting = true;
            }
        } else if (event.button === 2) { // Right click
            if (!isWeapon) {
                placementRotation = (placementRotation + 1) % 4;
            } else {
                isAiming = true;
            }
        }
    });

    document.addEventListener('mouseup', (event) => {
        if (!controls.isLocked) return;
        if (event.button === 0) {
            isShooting = false;
        } else if (event.button === 2) { // Right click release
            isAiming = false;
        }
    });

    // --- RESIZE EVENT ---
    window.addEventListener('resize', onWindowResize);
}

function spawnBuildingFromServer(data) {
    let geo;
    let shape;

    // Copy placement logic but using data properties
    let materialToUse = buildMaterial;
    let isEnvironment = false;

    if (data.type === 'wall') {
        geo = new THREE.BoxGeometry(GRID_SIZE, GRID_SIZE, 0.5);
        shape = new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, GRID_SIZE/2, 0.25));
    } else if (data.type === 'floor') {
        geo = new THREE.BoxGeometry(GRID_SIZE, 0.5, GRID_SIZE);
        shape = new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, 0.25, GRID_SIZE/2));
    } else if (data.type === 'bouncer') {
        geo = new THREE.BoxGeometry(GRID_SIZE, 0.5, GRID_SIZE);
        shape = new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, 0.25, GRID_SIZE/2));
        materialToUse = new THREE.MeshStandardMaterial({ color: 0xff00ff, emissive: 0xff00ff, emissiveIntensity: 1.5, wireframe: true });
    } else if (data.type === 'ramp') {
        const rampShape2D = new THREE.Shape();
        rampShape2D.moveTo(0, 0);
        rampShape2D.lineTo(GRID_SIZE, GRID_SIZE);
        rampShape2D.lineTo(GRID_SIZE, 0);
        rampShape2D.lineTo(0, 0);
        const extrudeSettings = { depth: GRID_SIZE, bevelEnabled: false };
        geo = new THREE.ExtrudeGeometry(rampShape2D, extrudeSettings);
        geo.translate(-GRID_SIZE/2, -GRID_SIZE/2, -GRID_SIZE/2);
        shape = new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, 0.5, Math.sqrt(GRID_SIZE*GRID_SIZE * 2)/2));
    } else if (data.type === 'tree') {
        // Simple stylized tree
        geo = new THREE.CylinderGeometry(1, 1, 6, 8); // trunk
        shape = new CANNON.Cylinder(1, 1, 6, 8);
        materialToUse = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9 });
        isEnvironment = true;
    } else if (data.type === 'bush') {
        geo = new THREE.SphereGeometry(2.5, 8, 8);
        shape = new CANNON.Sphere(2.5);
        materialToUse = new THREE.MeshStandardMaterial({ color: 0x2E8B57, roughness: 0.8 });
        isEnvironment = true;
    }

    const mesh = new THREE.Mesh(geo, materialToUse);

    if (!isEnvironment) {
        // Add thick outline edges to the building mesh
        const edges = new THREE.EdgesGeometry(geo);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00ffcc, linewidth: 4, opacity: 0.9, transparent: true }));
        mesh.add(line);
    }

    // If it's a tree, add leaves
    if (data.type === 'tree') {
        const leavesGeo = new THREE.ConeGeometry(3, 6, 8);
        const leavesMat = new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.8 });
        const leaves = new THREE.Mesh(leavesGeo, leavesMat);
        leaves.position.y = 4; // Top of the trunk
        leaves.castShadow = true;
        mesh.add(leaves);
    }

    mesh.position.set(data.x, data.y, data.z);
    mesh.rotation.y = data.rotation;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Spawn Animation for buildings
    if (!isEnvironment) {
        mesh.scale.set(0.1, 0.1, 0.1);
        let animStep = 0.1;
        const spawnAnim = setInterval(() => {
            animStep += 0.15;
            if (animStep >= 1.0) {
                animStep = 1.0;
                clearInterval(spawnAnim);
            }
            mesh.scale.set(animStep, animStep, animStep);
        }, 16);
    }

    mesh.userData = { isBuilding: true, health: data.health, id: data.id };
    scene.add(mesh);

    const body = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: shape,
        material: world.defaultMaterial
    });
    body.position.copy(mesh.position);
    body.quaternion.copy(mesh.quaternion);

    if (data.type === 'tree') {
        // Cannon.js Cylinder is oriented along Z, three.js is along Y. Rotate it.
        const q1 = new CANNON.Quaternion();
        q1.setFromAxisAngle(new CANNON.Vec3(1,0,0), Math.PI/2);
        body.quaternion.copy(q1);
    }

    if (data.type === 'ramp') {
        const q1 = new CANNON.Quaternion();
        q1.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/4);
        const q2 = new CANNON.Quaternion();
        q2.copy(body.quaternion);
        body.quaternion.copy(q2.mult(q1));
        body.position.y += GRID_SIZE/2;
    }

    body.userData = { type: data.type };

    world.addBody(body);
    builtObjects.push({ mesh, body, id: data.id });
}

// Tracers
let tracers = [];

function createTracer(startPoint, endPoint) {
    const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    const geometry = new THREE.BufferGeometry().setFromPoints([startPoint, endPoint]);
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    tracers.push({ mesh: line, life: 1.0 }); // Life from 1 to 0
}

// Shockwaves
let shockwaves = [];
const shockwaveGeo = new THREE.TorusGeometry(0.5, 0.1, 8, 24);

function createShockwave(position, normal) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 1.0, depthWrite: false });
    const mesh = new THREE.Mesh(shockwaveGeo, mat);
    mesh.position.copy(position);
    // Align with surface normal
    if (normal) {
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    }
    scene.add(mesh);
    shockwaves.push({ mesh: mesh, life: 1.0 });
}

function createParticles(position, type = 'spark', count = 10) {
    // Impact dynamic lighting flash (Graphics V16)
    if (type === 'spark') {
        const flashLight = new THREE.PointLight(0xffaa00, 5, 5);
        flashLight.position.copy(position);
        scene.add(flashLight);
        setTimeout(() => scene.remove(flashLight), 50);
    }

    for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(
            particleGeo,
            type === 'spark' ? sparkMat : debrisMat
        );

        // Spawn slightly offset from position to prevent clipping
        mesh.position.copy(position);
        mesh.position.x += (Math.random() - 0.5) * 0.5;
        mesh.position.y += (Math.random() - 0.5) * 0.5;
        mesh.position.z += (Math.random() - 0.5) * 0.5;

        scene.add(mesh);

        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10 + 5, // upward bias
            (Math.random() - 0.5) * 10
        );

        if (type === 'debris') velocity.multiplyScalar(0.5); // Debris slower

        particles.push({
            mesh: mesh,
            velocity: velocity,
            life: 1.0, // 1 second lifetime
            decay: type === 'spark' ? 2.0 : 1.0, // Spark fades faster
            gravity: type === 'debris' ? 9.8 : 2.0 // Debris falls faster
        });
    }
}

function useHeal() {
    if (isSpectator) return;
    if (health <= 0 || health >= currentMaxHealth) return;

    // Optimistically update health
    health = Math.min(currentMaxHealth, health + 25);
    const healthPct = Math.max(0, (health / currentMaxHealth) * 100);
    document.getElementById('healthBar').style.width = healthPct + '%';
    document.getElementById('healthText').innerText = `${health} HP`;

    // Let server know
    socket.emit('useHeal', { amount: 25 });

    // Switch back to previously held weapon, or hands if none
    if (myWeapons.length > 0) {
        setMode(myWeapons[0]);
    } else {
        setMode('hands');
    }
}

function updateAmmoUI() {
    const ammoContainer = document.getElementById('ammoContainer');
    const isWeaponMode = ['ar', 'smg', 'shotgun', 'sniper', 'pistol'].includes(currentMode);

    if (isWeaponMode) {
        ammoContainer.style.display = 'block';
        const ammo = ammoState[currentMode];
        document.getElementById('ammoText').innerText = isReloading ? "Reloading..." : `${ammo.current} / ${ammo.max}`;
    } else {
        ammoContainer.style.display = 'none';
    }
}

function reloadWeapon() {
    if (isSpectator || !['ar', 'smg', 'shotgun', 'sniper', 'pistol'].includes(currentMode) || isReloading) return;

    const ammo = ammoState[currentMode];
    if (ammo.current === ammo.max) return; // Already full

    isReloading = true;
    updateAmmoUI();

    // Visual reload animation (dip gun down)
    gunMesh.position.y -= 0.2;
    gunMesh.rotation.x -= 0.5;

    setTimeout(() => {
        ammo.current = ammo.max;
        isReloading = false;

        // Reset gun position
        gunMesh.position.y += 0.2;
        gunMesh.rotation.x += 0.5;

        updateAmmoUI();
    }, 1500); // 1.5s reload time
}

function shoot(time) {
    if (isSpectator) return;
    if (health <= 0) return; // Dead players can't shoot
    if (isReloading) return;

    // Fire Rates (ms delay between shots)
    const fireRates = {
        'ar': 120, // Full Auto
        'smg': 70, // Fast Auto
        'shotgun': 800, // Pump
        'sniper': 1500, // Bolt
        'pistol': 200 // Semi
    };

    const rate = fireRates[currentMode] || 150;
    if (time - lastShotTime < rate) return;

    // For semi-auto weapons, we force mouseup before next shot
    if (['shotgun', 'sniper', 'pistol'].includes(currentMode) && lastShotTime > 0 && time - lastShotTime < rate + 50) {
        // Only allow shooting if we just pressed it (handled roughly by the loop delay)
        // A better way: force them to release for semi-auto.
        // For simplicity, we just rely on the delay, but we'll manually reset isShooting for semi-auto
        isShooting = false;
    }

    lastShotTime = time;

    AudioManager.playShoot();
    const ammo = ammoState[currentMode];
    if (ammo) {
        if (ammo.current <= 0) {
            reloadWeapon();
            return;
        }
        ammo.current--;
        updateAmmoUI();
    }

    let damage = 35; // default AR
    let kickback = 0.15;
    let muzzleClimb = Math.PI / 16;

    if (currentMode === 'smg') {
        damage = 15;
        kickback = 0.08;
        muzzleClimb = Math.PI / 24;
    } else if (currentMode === 'shotgun') {
        damage = 80;
        kickback = 0.3;
        muzzleClimb = Math.PI / 8;
    } else if (currentMode === 'sniper') {
        damage = 150;
        kickback = 0.4;
        muzzleClimb = Math.PI / 6;
    } else if (currentMode === 'pistol') {
        damage = 25;
        kickback = 0.1;
        muzzleClimb = Math.PI / 20;
    }

    // Visual recoil & muzzle flash animation
    gunMesh.position.z = baseGunPosition.z + kickback; // Kickback
    gunMesh.rotation.x = muzzleClimb; // Upward muzzle climb

    // Camera shake recoil (Graphics V16)
    camera.rotation.x += (Math.random() * 0.05) * (damage / 100);
    camera.rotation.y += (Math.random() - 0.5) * 0.02;

    const flashGroup = gunMesh.getObjectByName("muzzleFlash");
    if (flashGroup) {
        flashGroup.children[0].intensity = 15; // Light
        // Randomize starburst rotation and increase opacity
        for(let i=1; i<=3; i++) {
            flashGroup.children[i].material.opacity = 1;
            flashGroup.children[i].rotation.z = Math.random() * Math.PI;
            flashGroup.children[i].scale.setScalar(1 + Math.random()*0.5);
        }
    }

    setTimeout(() => {
        gunMesh.position.z = baseGunPosition.z;
        gunMesh.rotation.x = 0;
        if (flashGroup) {
            flashGroup.children[0].intensity = 0;
            for(let i=1; i<=3; i++) flashGroup.children[i].material.opacity = 0;
        }
    }, 50); // Faster muzzle flash

    const raycaster = new THREE.Raycaster();
    const center = new THREE.Vector2(0, 0); // crosshair center
    raycaster.setFromCamera(center, camera);

    // Get origin of shot for tracers (roughly barrel position)
    const barrelPos = new THREE.Vector3(0, -0.1, -1);
    barrelPos.unproject(camera); // Convert from NDC back to world space roughly based on camera
    // A better approach is to take camera position and push it forward
    const shotOrigin = camera.position.clone().add(raycaster.ray.direction.clone().multiplyScalar(0.5));
    shotOrigin.y -= 0.1; // Offset down to match gun visually
    shotOrigin.x += 0.1;

    // Objects to shoot: built objects, other players AND bots
    const objectsToHit = builtObjects.map(obj => obj.mesh);
    for (let id in otherPlayers) {
        objectsToHit.push(otherPlayers[id].hitbox);
    }
    for (let id in botsLocal) {
        objectsToHit.push(botsLocal[id].hitbox);
    }

    const intersects = raycaster.intersectObjects(objectsToHit);

    // Visual hitmarker simple effect
    document.getElementById('crosshair').style.backgroundColor = 'red';
    setTimeout(() => { document.getElementById('crosshair').style.backgroundColor = 'transparent'; }, 50);

    let hitPoint = raycaster.ray.at(100, new THREE.Vector3()); // Default tracer end if no hit

    if (intersects.length > 0) {
        const hit = intersects[0];
        const hitMesh = hit.object;
        hitPoint = hit.point;

        // Spawn sparks & shockwave at hit point
        createParticles(hit.point, 'spark', 5);
        if (hit.face) createShockwave(hit.point, hit.face.normal);

        if (hitMesh.userData) {
            if (hitMesh.userData.isPlayer || hitMesh.userData.isBot) {
                // Hit another player or bot
                const isHeadshot = hit.point.y > hitMesh.position.y + 0.8;
                const finalDamage = isHeadshot ? Math.floor(damage * 2) : damage;
                socket.emit('playerHit', { targetId: hitMesh.userData.id, damage: finalDamage });

                // Audio + Hitmarker
                AudioManager.playHit(isHeadshot);
                const hitmarker = document.getElementById('hitmarker');
                hitmarker.style.display = 'block';
                hitmarker.style.transform = 'scale(1.5)';
                hitmarker.style.opacity = '1';
                setTimeout(() => {
                    hitmarker.style.transform = 'scale(1)';
                    hitmarker.style.opacity = '0';
                    setTimeout(() => hitmarker.style.display = 'none', 100);
                }, 100);

                // Damage Popup
                const dmgPopup = document.createElement('div');
                dmgPopup.innerText = finalDamage.toString();
                dmgPopup.style.position = 'absolute';
                dmgPopup.style.color = isHeadshot ? '#ffcc00' : 'white';
                dmgPopup.style.fontWeight = 'bold';
                dmgPopup.style.fontSize = isHeadshot ? '30px' : '20px';
                dmgPopup.style.textShadow = '0 0 5px black';
                document.getElementById('damagePopups').appendChild(dmgPopup);

                // Initial 3D position logic
                const posCopy = hit.point.clone();
                let op = 1;
                let yOffset = 0;

                const animDmg = setInterval(() => {
                    yOffset += 0.05;
                    posCopy.y += 0.05;
                    const screenPos = posCopy.clone().project(camera);

                    if (screenPos.z > 1) {
                        dmgPopup.style.display = 'none';
                    } else {
                        dmgPopup.style.display = 'block';
                        const x = (screenPos.x * .5 + .5) * window.innerWidth;
                        const y = (-(screenPos.y * .5) + .5) * window.innerHeight;
                        dmgPopup.style.left = `${x}px`;
                        dmgPopup.style.top = `${y}px`;
                        dmgPopup.style.opacity = op;
                    }

                    op -= 0.02;
                    if (op <= 0) {
                        clearInterval(animDmg);
                        dmgPopup.remove();
                    }
                }, 16);

            } else if (hitMesh.userData.isBuilding) {
                // Tell server we hit a building
                if (socket && hitMesh.userData.id) {
                    socket.emit('hitObject', { objId: hitMesh.userData.id });
                }
            }
        }
    }

    // Always draw tracer
    createTracer(shotOrigin, hitPoint);
}

function destroyBuilding(mesh) {
    // Find the object in builtObjects
    const index = builtObjects.findIndex(obj => obj.mesh === mesh);
    if (index > -1) {
        const obj = builtObjects[index];

        // Remove from scene and physics
        scene.remove(obj.mesh);
        world.removeBody(obj.body);

        // Cleanup memory
        obj.mesh.geometry.dispose();
        // keep material if shared

        // Remove from array
        builtObjects.splice(index, 1);
    }
}

function setMode(mode) {
    if (isReloading) return; // Prevent switching while reloading
    currentMode = mode;
    isAiming = false; // Reset ADS on switch
    updateAmmoUI();

    // Toggle weapon visibility
    const isWeapon = mode === 'ar' || mode === 'smg' || mode === 'shotgun' || mode === 'sniper' || mode === 'pistol';
    if (gunMesh) {
        gunMesh.visible = isWeapon;
        if (isWeapon) {
            gunMesh.children.forEach(c => {
                if (['ar', 'smg', 'shotgun', 'sniper', 'pistol'].includes(c.name)) {
                    c.visible = (c.name === mode);
                }
            });
        }
    }

    // Update UI
    let displayMode = mode === 'ar' ? 'Assault Rifle' : mode === 'smg' ? 'SMG' : mode === 'shotgun' ? 'Shotgun' : mode === 'sniper' ? 'Sniper' : mode === 'pistol' ? 'Pistol' : mode;
    document.getElementById('modeDisplay').innerText = `Mode: ${displayMode.charAt(0).toUpperCase() + displayMode.slice(1)}`;
    document.querySelectorAll('.slot').forEach(el => el.classList.remove('active'));

    if(mode === 'ar') document.getElementById('slot-1').classList.add('active');
    if(mode === 'smg') document.getElementById('slot-2').classList.add('active');
    if(mode === 'shotgun') document.getElementById('slot-3').classList.add('active');
    if(mode === 'sniper') document.getElementById('slot-8').classList.add('active');
    if(mode === 'pistol') document.getElementById('slot-9').classList.add('active');
    if(mode === 'wall') document.getElementById('slot-4').classList.add('active');
    if(mode === 'floor') document.getElementById('slot-5').classList.add('active');
    if(mode === 'ramp') document.getElementById('slot-6').classList.add('active');
    if(mode === 'bouncer') document.getElementById('slot-0').classList.add('active');
    if(mode === 'heal') document.getElementById('slot-7').classList.add('active');

    // Reset rotation on mode switch
    placementRotation = 0;
}

function editBuilding() {
    if (isSpectator) return;

    // Raycast from camera center to find a building
    const raycaster = new THREE.Raycaster();
    const center = new THREE.Vector2(0, 0);
    raycaster.setFromCamera(center, camera);

    const objectsToHit = builtObjects.map(obj => obj.mesh);
    const intersects = raycaster.intersectObjects(objectsToHit);

    if (intersects.length > 0 && intersects[0].distance < GRID_SIZE * 1.5) {
        const hitMesh = intersects[0].object;

        // Find in local array
        const index = builtObjects.findIndex(obj => obj.mesh === hitMesh);
        if (index > -1) {
            const obj = builtObjects[index];

            // Only allow editing our own buildings (or if server owns them for sandbox fun, but ideally only ours)
            if (obj.mesh.userData && obj.mesh.userData.id) {
                // If it's a wall, create a door hole
                if (obj.body.userData.type === 'wall') {
                    // Update server
                    socket.emit('editObject', { objId: obj.mesh.userData.id, editType: 'door' });
                } else if (obj.body.userData.type === 'floor') {
                    socket.emit('editObject', { objId: obj.mesh.userData.id, editType: 'half' });
                }
            }
        }
    }
}

function placeBuilding() {
    if (!['wall', 'floor', 'ramp', 'bouncer'].includes(currentMode)) return; // Safety check
    AudioManager.playBuild();

    let activeGhost = currentMode === 'ramp' ? ghostRampMesh : ghostMesh;

    let geo;
    let shape;
    let mat = buildMaterial;

    if (currentMode === 'wall') {
        geo = new THREE.BoxGeometry(GRID_SIZE, GRID_SIZE, 0.5);
        shape = new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, GRID_SIZE/2, 0.25));
    } else if (currentMode === 'floor') {
        geo = new THREE.BoxGeometry(GRID_SIZE, 0.5, GRID_SIZE);
        shape = new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, 0.25, GRID_SIZE/2));
    } else if (currentMode === 'bouncer') {
        geo = new THREE.BoxGeometry(GRID_SIZE, 0.5, GRID_SIZE);
        shape = new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, 0.25, GRID_SIZE/2));
        mat = new THREE.MeshStandardMaterial({ color: 0xff00ff, emissive: 0xff00ff, emissiveIntensity: 1.5, wireframe: true });
    } else if (currentMode === 'ramp') {
        // Simple approximation for cannon.js physics for ramp (using a box rotated)
        geo = ghostRampMesh.geometry.clone(); // Re-use the extrude geometry
        shape = new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, 0.5, Math.sqrt(GRID_SIZE*GRID_SIZE * 2)/2));
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(activeGhost.position);
    mesh.rotation.copy(activeGhost.rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Add thick outline edges to the building mesh
    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00ffcc, linewidth: 4, opacity: 0.9, transparent: true }));
    mesh.add(line);

    // Generate a temporary ID until server confirms
    if (socket) {
        socket.emit('buildObject', {
            type: currentMode,
            x: activeGhost.position.x,
            y: activeGhost.position.y,
            z: activeGhost.position.z,
            rotation: activeGhost.rotation.y
        });
    }

    // Add health data for shooting later
    const tempId = 'temp_' + Math.random();
    mesh.userData = { isBuilding: true, health: 100, id: tempId };

    // Spawn Animation for locally placed buildings
    mesh.scale.set(0.1, 0.1, 0.1);
    let animStep = 0.1;
    const spawnAnim = setInterval(() => {
        animStep += 0.15;
        if (animStep >= 1.0) {
            animStep = 1.0;
            clearInterval(spawnAnim);
        }
        mesh.scale.set(animStep, animStep, animStep);
    }, 16);

    scene.add(mesh);

    const body = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: shape,
        material: world.defaultMaterial
    });
    body.position.copy(activeGhost.position);
    body.quaternion.copy(activeGhost.quaternion);

    if (currentMode === 'ramp') {
        // Adjust physics body for ramp (it's a rotated box)
        const q1 = new CANNON.Quaternion();
        q1.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/4); // 45 deg slope

        const q2 = new CANNON.Quaternion();
        q2.copy(body.quaternion); // Y rotation from placement

        body.quaternion.copy(q2.mult(q1));

        // Offset physics slightly to match the visual mesh base
        body.position.y += GRID_SIZE/2;
    }

    body.userData = { type: currentMode };

    world.addBody(body);

    builtObjects.push({ mesh, body, id: tempId, isTemp: true });
}

function updateGhostPlacement() {
    const isBuilding = ['wall', 'floor', 'ramp', 'bouncer'].includes(currentMode);
    if (!isBuilding) {
        ghostMesh.visible = false;
        ghostRampMesh.visible = false;
        return;
    }

    // Determine which ghost to use
    const isRamp = currentMode === 'ramp';
    ghostMesh.visible = !isRamp;
    ghostRampMesh.visible = isRamp;
    const activeGhost = isRamp ? ghostRampMesh : ghostMesh;

    // Raycast from center to find what we are looking at
    const raycaster = new THREE.Raycaster();
    const center = new THREE.Vector2(0, 0); // screen center
    raycaster.setFromCamera(center, camera);

    // Objects to test against: ground + all built objects
    const intersectObjects = scene.children.filter(c => c.type === 'Mesh' && c !== ghostMesh && c !== ghostRampMesh);
    const intersects = raycaster.intersectObjects(intersectObjects);

    let point = new THREE.Vector3();
    let normal = new THREE.Vector3(0, 1, 0);

    if (intersects.length > 0) {
        // Place building a bit further along the ray if we hit something far
        const dist = Math.min(intersects[0].distance, GRID_SIZE * 2);
        point.copy(raycaster.ray.at(dist, new THREE.Vector3()));
    } else {
        // Point in thin air if nothing hit
        point.copy(raycaster.ray.at(GRID_SIZE * 2, new THREE.Vector3()));
    }

    // Grid snapping logic
    // Round position to nearest GRID_SIZE
    const snappedX = Math.round(point.x / GRID_SIZE) * GRID_SIZE;
    const snappedZ = Math.round(point.z / GRID_SIZE) * GRID_SIZE;
    let snappedY = Math.max(0, Math.floor(point.y / GRID_SIZE) * GRID_SIZE); // Ground is 0

    // Set geometry based on mode (reuse cached geometries)
    if (currentMode === 'wall') {
        if (ghostMesh.geometry !== ghostMaterial.userData.wallGeo) {
            ghostMesh.geometry = ghostMaterial.userData.wallGeo;
        }
        // Position wall between grid centers
        snappedY += GRID_SIZE / 2;
    } else if (currentMode === 'floor' || currentMode === 'bouncer') {
        if (ghostMesh.geometry !== ghostMaterial.userData.floorGeo) {
            ghostMesh.geometry = ghostMaterial.userData.floorGeo;
        }
        snappedY += GRID_SIZE; // Place on top of current grid level
    } else if (currentMode === 'ramp') {
        snappedY += GRID_SIZE / 2;
    }

    activeGhost.position.set(snappedX, snappedY, snappedZ);

    // Apply Rotation
    activeGhost.rotation.set(0, 0, 0); // reset
    if (currentMode === 'wall') {
        activeGhost.rotation.y = placementRotation * (Math.PI / 2);
    } else if (currentMode === 'ramp') {
        activeGhost.rotation.y = placementRotation * (Math.PI / 2);
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if(composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
        // Need to find the fxaaPass. We can assume it's the 4th pass.
        const fxaaPass = composer.passes.find(p => p.material && p.material.uniforms && p.material.uniforms.resolution);
        if (fxaaPass) {
            const pixelRatio = renderer.getPixelRatio();
            fxaaPass.material.uniforms['resolution'].value.x = 1 / (window.innerWidth * pixelRatio);
            fxaaPass.material.uniforms['resolution'].value.y = 1 / (window.innerHeight * pixelRatio);
        }
    }
}

function interactWithPickup() {
    if (window.currentPickupId && !isSpectator) {
        socket.emit('pickupWeapon', { spawnId: window.currentPickupId });
    }
}

function triggerEmote() {
    if (isSpectator || equippedEmote === 'none') return;
    socket.emit('triggerEmote', { emote: equippedEmote });

    // Play our own animation in first person (simple screen shake/bob for now since arms aren't rendered separately)
    const originalY = camera.position.y;
    if (equippedEmote === 'flip') {
        const shake = setInterval(() => {
            camera.rotation.x += 0.1;
        }, 16);
        setTimeout(() => clearInterval(shake), 1000);
    }
}

function renderMinimap() {
    if (isSpectator || !playerBody) return;

    const canvas = document.getElementById('minimapCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, 200, 200);

    // Config
    const mapScale = 0.5; // How much world space fits in minimap
    const centerX = 100;
    const centerY = 100;

    // Draw background/grid
    ctx.fillStyle = 'rgba(0, 255, 204, 0.05)';
    ctx.fillRect(0,0,200,200);
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.2)';
    ctx.lineWidth = 1;
    for(let i=0; i<200; i+=20) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 200); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(200, i); ctx.stroke();
    }

    const myPos = playerBody.position;

    // Draw other players (red dots)
    ctx.fillStyle = '#ff0000';
    for (let id in otherPlayers) {
        const p = otherPlayers[id].group.position;
        const dx = (p.x - myPos.x) * mapScale;
        const dz = (p.z - myPos.z) * mapScale;
        // Only draw if within minimap bounds
        if (Math.sqrt(dx*dx + dz*dz) < 100) {
            ctx.beginPath(); ctx.arc(centerX + dx, centerY + dz, 4, 0, Math.PI*2); ctx.fill();
        }
    }

    // Draw bots (green dots)
    ctx.fillStyle = '#00ff00';
    for (let id in botsLocal) {
        const b = botsLocal[id].group.position;
        const dx = (b.x - myPos.x) * mapScale;
        const dz = (b.z - myPos.z) * mapScale;
        if (Math.sqrt(dx*dx + dz*dz) < 100) {
            ctx.beginPath(); ctx.arc(centerX + dx, centerY + dz, 3, 0, Math.PI*2); ctx.fill();
        }
    }

    // Draw storm (purple circle)
    if (stormMesh && stormMesh.targetRadius) {
        const dx = (stormMesh.targetPosition.x - myPos.x) * mapScale;
        const dz = (stormMesh.targetPosition.z - myPos.z) * mapScale;
        const r = stormMesh.targetRadius * mapScale;
        ctx.strokeStyle = '#cc00ff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(centerX + dx, centerY + dz, r, 0, Math.PI*2); ctx.stroke();
    }

    // Draw self (cyan dot with direction)
    ctx.fillStyle = '#00ffcc';
    ctx.beginPath(); ctx.arc(centerX, centerY, 5, 0, Math.PI*2); ctx.fill();

    // Direction line
    const angle = controls.getObject().rotation.y;
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    // Note: Canvas Y is down, Three Z is forward (-). Need to map angles correctly.
    ctx.lineTo(centerX + Math.sin(angle) * 12, centerY - Math.cos(angle) * 12);
    ctx.stroke();
}

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    // Animate Overshield (Graphics V17)
    if (window.overshieldPass) {
        if (health > 100) {
            const intensity = 0.05 + Math.sin(time * 0.005) * 0.02; // Pulsing shield
            window.overshieldPass.uniforms["shieldIntensity"].value = intensity;
        } else {
            window.overshieldPass.uniforms["shieldIntensity"].value = 0.0;
        }
    }

    // Animate Low Health Pulse
    if (health > 0 && health <= 30) {
        const pulse = 0.4 + Math.sin(time * 0.005) * 0.3; // values between 0.1 and 0.7
        const overlay = document.getElementById('lowHealthOverlay');
        if(overlay) overlay.style.boxShadow = `inset 0 0 150px 50px rgba(255, 0, 0, ${pulse})`;
    }

    // Check for weapon pickups
    if (!interactionText) interactionText = document.getElementById('interactionText');
    let canPickup = false;
    let pickupId = null;

    for (let id in weaponSpawnsLocal) {
        let ws = weaponSpawnsLocal[id];
        if (ws.active) {
            // Animate
            ws.mesh.rotation.y += delta;
            ws.mesh.position.y = ws.mesh.position.y + Math.sin(time * 0.005) * 0.002;

            // Distance check
            if (controls.isLocked && playerBody) {
                const dist = playerBody.position.distanceTo(ws.mesh.position);
                if (dist < 3) {
                    canPickup = true;
                    pickupId = id;
                }
            }
        }
    }

    if (canPickup && !isSpectator) {
        interactionText.style.display = 'block';
        interactionText.innerText = `Press E to Pick Up ${weaponSpawnsLocal[pickupId].type.toUpperCase()}`;
        // Store for E key
        window.currentPickupId = pickupId;
    } else {
        interactionText.style.display = 'none';
        window.currentPickupId = null;
    }

    // Smooth Storm transition
    if (stormMesh && stormMesh.targetRadius !== undefined) {
        const r = stormMesh.scale.x;
        const newR = THREE.MathUtils.lerp(r, stormMesh.targetRadius, delta * 0.5);
        stormMesh.scale.set(newR, 1, newR);

        stormMesh.position.x = THREE.MathUtils.lerp(stormMesh.position.x, stormMesh.targetPosition.x, delta * 0.5);
        stormMesh.position.z = THREE.MathUtils.lerp(stormMesh.position.z, stormMesh.targetPosition.z, delta * 0.5);

        // Rotate storm texture/mesh slowly
        stormMesh.rotation.y += delta * 0.1;
    }

    // Animate bots
    for (let id in botsLocal) {
        const bot = botsLocal[id];
        // simple wobble
        bot.group.children[0].position.y = 0.6 + Math.sin(time * 0.01) * 0.05;
        bot.group.children[1].position.y = 1.45 + Math.sin(time * 0.01) * 0.05;
        bot.group.children[2].position.y = 1.45 + Math.sin(time * 0.01) * 0.05;
    }

    // Animate Emotes on other players
    for (let id in otherPlayers) {
        const p = otherPlayers[id];
        if (p.activeEmote !== 'none') {
            const elapsed = time - p.emoteTimer;
            const body = p.group.children[0];
            const leftArm = p.group.children[3];
            const rightArm = p.group.children[4];

            if (p.activeEmote === 'wave') {
                rightArm.rotation.x = Math.sin(elapsed * 0.01) * 0.5 - Math.PI/2;
                rightArm.rotation.z = Math.sin(elapsed * 0.01) * 0.5;
                if (elapsed > 2000) p.activeEmote = 'none'; // stop after 2s
            } else if (p.activeEmote === 'spin') {
                p.group.rotation.y += delta * 10;
                if (elapsed > 1500) p.activeEmote = 'none';
            } else if (p.activeEmote === 'flip') {
                // Backflip entire group around X axis
                const progress = Math.min(1, elapsed / 1000);
                p.group.rotation.x = progress * Math.PI * 2;
                p.group.position.y += Math.sin(progress * Math.PI) * delta * 5;
                if (elapsed > 1000) {
                    p.activeEmote = 'none';
                    p.group.rotation.x = 0;
                }
            } else if (p.activeEmote === 'tpose') {
                leftArm.rotation.x = 0; leftArm.rotation.z = Math.PI / 2;
                rightArm.rotation.x = 0; rightArm.rotation.z = -Math.PI / 2;
                if (elapsed > 3000) p.activeEmote = 'none';
            } else if (p.activeEmote === 'headbang') {
                const head = p.group.children[1];
                const visor = p.group.children[2];
                const angle = Math.sin(elapsed * 0.02) * (Math.PI / 4) + (Math.PI / 8);
                head.rotation.x = angle;
                visor.rotation.x = angle;
                if (elapsed > 3000) {
                    p.activeEmote = 'none';
                    head.rotation.x = 0;
                    visor.rotation.x = 0;
                }
            } else if (p.activeEmote === 'levitate') {
                const progress = Math.min(1, elapsed / 3000);
                p.group.position.y += Math.sin(elapsed * 0.005) * 0.02;
                leftArm.rotation.x = -Math.PI; leftArm.rotation.z = Math.sin(elapsed * 0.005) * 0.1;
                rightArm.rotation.x = -Math.PI; rightArm.rotation.z = -Math.sin(elapsed * 0.005) * 0.1;
                if (elapsed > 4000) p.activeEmote = 'none';
            } else if (p.activeEmote === 'floss') {
                const phase = elapsed * 0.015;
                leftArm.rotation.z = Math.sin(phase) * Math.PI / 4;
                rightArm.rotation.z = Math.sin(phase + Math.PI) * Math.PI / 4;
                leftArm.rotation.x = Math.PI / 8;
                rightArm.rotation.x = Math.PI / 8;
                // Hip sway
                body.rotation.y = Math.sin(phase * 2) * 0.3;
                if (elapsed > 3000) {
                    p.activeEmote = 'none';
                    body.rotation.y = 0;
                }
            }
        } else {
            // Reset arm positions if not emoting
            if (p.group.children[3]) {
                p.group.children[3].rotation.x = -Math.PI / 4;
                p.group.children[3].rotation.z = 0;
            }
            if (p.group.children[4]) {
                p.group.children[4].rotation.x = -Math.PI / 4;
                p.group.children[4].rotation.z = 0;
            }
        }
    }

    // Update Dust Particles
    if (dustParticles) {
        dustParticles.rotation.y += delta * 0.05;
        const positions = dustParticles.geometry.attributes.position.array;
        for (let i = 1; i < dustParticles.geometry.attributes.position.count * 3; i += 3) {
            positions[i] -= delta * 0.5; // fall slowly
            if (positions[i] < -50) positions[i] = 50; // wrap around
        }
        dustParticles.geometry.attributes.position.needsUpdate = true;
    }

    // Active Map Animations (Texture Scrolling)
    if (activeGroundMesh && activeGroundMesh.material.map) {
        if (currentMap === 'lava') {
            activeGroundMesh.material.map.offset.y -= delta * 0.05; // Flowing lava
            activeGroundMesh.material.map.offset.x += delta * 0.02;
        } else if (currentMap === 'space') {
            activeGroundMesh.material.map.offset.y += delta * 0.02; // Moving space grid
        }
    }

    // Stylized Ocean Animation
    // Only animate a subset or optimize it to prevent massive slowdown on 1000x1000 high-poly grid
    if (oceanMesh && oceanMesh.visible && !window.location.search.includes('disable_ocean')) {
        // Disable computeVertexNormals every frame in playwright as it can crash the screenshotting tool on large arrays
        const positions = oceanMesh.geometry.attributes.position.array;
        // Optimization: only update vertices somewhat near the player (e.g. within 200 units)
        const pX = camera.position.x;
        const pZ = camera.position.z;
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i+2];
            if (Math.abs(x - pX) < 200 && Math.abs(z - pZ) < 200) {
                positions[i+1] = Math.sin((x * 0.05) + time * 0.001) * 2 + Math.cos((z * 0.05) + time * 0.002) * 2 - 5;
            }
        }
        oceanMesh.geometry.attributes.position.needsUpdate = true;
    }

    // Time of Day Animation (Dynamic Sun)
    if (globalSky && globalDirLight) {
        timeOfDay += delta * 0.2; // Speed of day cycle
        if (timeOfDay > 24) timeOfDay = 0;

        const phi = THREE.MathUtils.degToRad(90 - (timeOfDay - 6) * 15);
        const theta = THREE.MathUtils.degToRad(180);
        const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

        globalSky.material.uniforms['sunPosition'].value.copy(sunPosition);
        globalDirLight.position.copy(sunPosition).multiplyScalar(100);

        const sunHeight = Math.max(0, Math.sin(THREE.MathUtils.degToRad((timeOfDay - 6) * 15)));
        globalDirLight.intensity = 1.5 * sunHeight;

        // Note: We don't update PMREM every frame as it's too expensive,
        // so reflections stay static while lighting/shadows move dynamically.
    }

    // Update Shockwaves
    for (let i = shockwaves.length - 1; i >= 0; i--) {
        let sw = shockwaves[i];
        sw.life -= delta * 3.0; // Fade speed
        sw.mesh.scale.addScalar(delta * 15.0); // Expand speed
        sw.mesh.material.opacity = sw.life;
        if (sw.life <= 0) {
            scene.remove(sw.mesh);
            sw.mesh.material.dispose(); // Avoid memory leaks
            shockwaves.splice(i, 1);
        }
    }

    // Update Tracers
    for (let i = tracers.length - 1; i >= 0; i--) {
        tracers[i].life -= delta * 15; // Fade fast
        tracers[i].mesh.material.opacity = tracers[i].life;
        if (tracers[i].life <= 0) {
            scene.remove(tracers[i].mesh);
            tracers[i].mesh.geometry.dispose(); // Avoid memory leaks
            tracers[i].mesh.material.dispose();
            tracers.splice(i, 1);
        }
    }

    // Update Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        // Gravity
        p.velocity.y -= (p.gravity || 9.8) * delta;

        p.mesh.position.addScaledVector(p.velocity, delta);
        p.mesh.rotation.x += p.velocity.x * delta;
        p.mesh.rotation.y += p.velocity.y * delta;

        p.life -= p.decay * delta;

        if (p.mesh.material === sparkMat) {
             p.mesh.scale.setScalar(Math.max(0, p.life)); // Shrink sparks
        }

        if (p.life <= 0 || p.mesh.position.y < -5) {
            scene.remove(p.mesh);
            particles.splice(i, 1);
        }
    }

    if (controls.isLocked === true) {
        // Apply movement forces to physics body based on camera direction
        const moveDir = new THREE.Vector3();
        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize(); // Ensure consistent speed in all directions

        // Update crosshair spread based on movement/shooting state
        let targetSpread = 20;

        // Get camera rotation (yaw only for movement)
        const euler = new THREE.Euler(0, 0, 0, 'YXZ');
        euler.y = controls.getObject().rotation.y;

        if (moveForward || moveBackward) {
            moveDir.set(0, 0, -direction.z).applyEuler(euler);
        }
        if (moveLeft || moveRight) {
            const sideDir = new THREE.Vector3(direction.x, 0, 0).applyEuler(euler);
            moveDir.add(sideDir);
        }

        moveDir.normalize();

        if (moveForward || moveBackward || moveLeft || moveRight) {
             let currentSpeed = speed;
             if (isSliding && slideTimer > 0) {
                 currentSpeed = speed * 2.0 * (slideTimer / 0.8); // Fast then slow down
                 slideTimer -= delta;
                 if(slideTimer <= 0) isSliding = false;
                 targetFov = 100; // Even wider FOV for sliding
                 targetSpread = 40;
             } else if (isCrouching) {
                 currentSpeed = speed * 0.5;
                 targetFov = 70;
                 targetSpread = 15;
             } else if (isSprinting) {
                 currentSpeed = speed * 1.5;
                 targetFov = 95;
                 targetSpread = 50;
             } else {
                 targetFov = 75;
                 targetSpread = 30;
             }
             playerBody.velocity.x = moveDir.x * currentSpeed;
             playerBody.velocity.z = moveDir.z * currentSpeed;
        } else {
             targetFov = 75;
             isSliding = false;
             if (isCrouching) targetSpread = 10;
        }

        // Add spread from recoil
        if (weaponRecoilState) targetSpread += 20;

        // Lerp crosshair scale
        currentCrosshairSpread += (targetSpread - currentCrosshairSpread) * delta * 15;
        const ch = document.getElementById('crosshair');
        if (ch) {
             ch.style.width = `${currentCrosshairSpread}px`;
             ch.style.height = `${currentCrosshairSpread}px`;
        }

        // Handle FOV changes for sprint feel
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, delta * 10);
        camera.updateProjectionMatrix();

        // Handle Screen Shake
        if (screenShakeIntensity > 0) {
            camera.position.x += (Math.random() - 0.5) * screenShakeIntensity;
            camera.position.y += (Math.random() - 0.5) * screenShakeIntensity;
            camera.position.z += (Math.random() - 0.5) * screenShakeIntensity;
            screenShakeIntensity -= delta * 0.5; // Fade out shake
            if (screenShakeIntensity < 0) screenShakeIntensity = 0;
        }

        // Update Building ghost
        updateGhostPlacement();

        // Send my position to server
        if (socket && playerBody) {
             socket.emit('playerMove', {
                 x: playerBody.position.x,
                 y: playerBody.position.y,
                 z: playerBody.position.z,
                 rotation: controls.getObject().rotation.y
             });
        }
    }
    prevTime = time;

    // Step physics world
    const timeStep = 1 / 60;
    world.step(timeStep);

    // Sync camera to physics body
    controls.getObject().position.copy(playerBody.position);

    // View Bobbing & Weapon Sway logic
    let targetCameraY = isCrouching ? 0.0 : 0.5; // Lower camera if crouching/sliding

    if (controls.isLocked) {
        // Calculate player speed in XZ plane
        const currentSpeed = Math.sqrt(playerBody.velocity.x**2 + playerBody.velocity.z**2);

        // Only bob if moving and on the ground
        if (currentSpeed > 0.1 && canJump) {
            bobTimer += delta * 10.0;
            // Bob formula: sine wave based on time * speed
            targetCameraY = 0.5 + Math.sin(bobTimer) * 0.08;

            // Footsteps
            footstepTimer -= delta;
            if (footstepTimer <= 0) {
                AudioManager.playFootstep();
                if (isSprinting && !isCrouching) {
                    footstepTimer = 0.3;
                } else if (isCrouching) {
                    footstepTimer = 0.6;
                } else {
                    footstepTimer = 0.45;
                }
            }

            // Gun bobs with camera but slightly offset
            const isWeaponMode = ['ar', 'smg', 'shotgun', 'sniper', 'pistol'].includes(currentMode);
            if (isWeaponMode) {
                gunMesh.position.y = baseGunPosition.y + Math.sin(bobTimer * 2) * 0.02;
                gunMesh.position.x = baseGunPosition.x + Math.cos(bobTimer) * 0.02;
            }
        } else {
            bobTimer = 0; // Reset when standing still
            // Slowly return gun to base rest position
            const isWeaponMode = ['ar', 'smg', 'shotgun', 'sniper', 'pistol'].includes(currentMode);
            if (isWeaponMode) {
                gunMesh.position.y = THREE.MathUtils.lerp(gunMesh.position.y, baseGunPosition.y, delta * 10);
                gunMesh.position.x = THREE.MathUtils.lerp(gunMesh.position.x, baseGunPosition.x, delta * 10);
            }
        }

        // Weapon Sway interpolation
        const isWeaponMode = ['ar', 'smg', 'shotgun', 'sniper', 'pistol'].includes(currentMode);
        if (isWeaponMode) {
            // Apply sway inverse to mouse movement
            gunMesh.position.x -= gunSwayVelocity.x;
            gunMesh.position.y -= gunSwayVelocity.y;

            // Constrain gun position so it doesn't fly off screen
            const maxX = baseGunPosition.x + 0.1;
            const minX = baseGunPosition.x - 0.1;
            const maxY = baseGunPosition.y + 0.1;
            const minY = baseGunPosition.y - 0.1;

            gunMesh.position.x = THREE.MathUtils.clamp(gunMesh.position.x, minX, maxX);
            gunMesh.position.y = THREE.MathUtils.clamp(gunMesh.position.y, minY, maxY);

            // Decay sway velocity (spring back to center)
            gunSwayVelocity.lerp(new THREE.Vector2(0, 0), delta * 10);
        }
    }

    // Offset camera slightly up to represent eye level (sphere radius is 0.5 + bobbing)
    controls.getObject().position.y += targetCameraY;

    // Handle Automatic Shooting
    if (isShooting) {
        const isWeaponMode = ['ar', 'smg', 'shotgun', 'sniper', 'pistol'].includes(currentMode);
        if (isWeaponMode) {
            shoot(time);
        }
    }

    // Render the Minimap overlay
    renderMinimap();

    // Use composer instead of renderer for bloom
    if (health > 0 && !isSpectator) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}
