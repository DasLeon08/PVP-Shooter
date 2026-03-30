import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { Sky } from 'three/addons/objects/Sky.js';

// --- Globals ---
let camera, scene, renderer, composer;
let world;
let controls;
let playerBody;
let socket;
let myId;
let otherPlayers = {}; // To store meshes of other players
let currentMap = 'classic';
let health = 100;

// Build System State
let currentMode = 'weapon'; // weapon, wall, floor, ramp
const GRID_SIZE = 5;
let gunMesh;

// Weapon & Camera Sway State
const baseGunPosition = new THREE.Vector3(0.3, -0.3, -0.5);
let gunSwayVelocity = new THREE.Vector2(0, 0);
let bobTimer = 0;

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

const buildMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: gridTexture,
    bumpMap: bumpTexture,
    bumpScale: 0.05,
    metalness: 0.7,
    roughness: 0.2,
    transparent: true,
    opacity: 0.95, // Almost solid, just a hint of light pass-through
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
let dustParticles;

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

document.getElementById('playBtn').addEventListener('click', () => {
    isSpectator = false;
    document.getElementById('mainMenu').style.display = 'none';

    // Show UI
    document.getElementById('crosshair').style.display = 'block';
    document.getElementById('ui').style.display = 'block';
    document.getElementById('hotbar').style.display = 'flex';
    document.getElementById('healthBarContainer').style.display = 'block';
    document.getElementById('instructions').style.display = 'flex';

    currentMap = document.getElementById('mapSelect').value;

    initNetwork();
    init();
    animate();
});

document.getElementById('spectateBtn').addEventListener('click', () => {
    isSpectator = true;
    document.getElementById('mainMenu').style.display = 'none';

    // Hide combat UI for spectators
    document.getElementById('crosshair').style.display = 'none';
    document.getElementById('ui').style.display = 'none';
    document.getElementById('hotbar').style.display = 'none';
    document.getElementById('healthBarContainer').style.display = 'none';
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

        // Sort by kills
        const sorted = players.sort((a, b) => b.kills - a.kills);

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

        socket.emit('joinMap', { map: currentMap, isSpectator: isSpectator });

        // Load existing buildings
        const existingObjects = data.builtObjects;
        for (let objId in existingObjects) {
            if (existingObjects[objId].map === currentMap) {
                 spawnBuildingFromServer(existingObjects[objId]);
            }
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
        if (data.map !== currentMap) return;

        spawnBuildingFromServer(data);
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

            // Don't render ourselves or players on different maps
            if (id === myId) continue;

            if (p.map !== currentMap) {
                 if (otherPlayers[id]) {
                     scene.remove(otherPlayers[id].mesh);
                     delete otherPlayers[id];
                 }
                 continue;
            }

            // Create mesh if it doesn't exist
            if (!otherPlayers[id]) {
                const playerGroup = new THREE.Group();

                // Body
                const bodyGeo = new THREE.BoxGeometry(0.8, 1.2, 0.4);
                const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff0044, metalness: 0.6, roughness: 0.2 });
                const pBodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
                pBodyMesh.position.y = 0.6; // Body rests on group origin (feet)
                pBodyMesh.castShadow = true;

                // Head
                const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
                const headMat = new THREE.MeshStandardMaterial({ color: 0xff3333, metalness: 0.5, roughness: 0.5 });
                const headMesh = new THREE.Mesh(headGeo, headMat);
                headMesh.position.y = 1.45; // Top of body
                headMesh.castShadow = true;

                // Visor / Eye (Cyberpunk style)
                const visorGeo = new THREE.BoxGeometry(0.4, 0.1, 0.1);
                const visorMat = new THREE.MeshStandardMaterial({ color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 2.0 });
                const visorMesh = new THREE.Mesh(visorGeo, visorMat);
                visorMesh.position.set(0, 1.45, -0.26); // Front of face

                playerGroup.add(pBodyMesh);
                playerGroup.add(headMesh);
                playerGroup.add(visorMesh);

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
                    hitbox: hitbox // Store hitbox reference for shooting
                };
            }

            // Update position and rotation smoothly
            // Adjust y so feet are at ground level (player physics body radius is 0.5, position is center)
            otherPlayers[id].group.position.set(p.x, p.y - 0.5, p.z);
            otherPlayers[id].group.rotation.y = p.rotation;
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
            document.getElementById('healthBar').style.width = Math.max(0, health) + '%';
        }
    });

    socket.on('playerRespawn', (data) => {
        if (data.id === myId) {
            health = data.health;
            document.getElementById('healthBar').style.width = '100%';

            // Teleport physics body
            playerBody.position.set(data.x, data.y, data.z);
            playerBody.velocity.set(0,0,0);
        }
    });
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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    // SSAO Pass (Ambient Occlusion for shadows in corners, like 1v1.lol)
    const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
    ssaoPass.kernelRadius = 12; // Decrease radius for sharper shadows in corners
    ssaoPass.minDistance = 0.002; // Tighter min distance
    ssaoPass.maxDistance = 0.05; // Shorter max distance (prevents muddying flat surfaces)

    // Controlled bloom for neon glows without washing out sky
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.0, 0.4, 0.85);
    bloomPass.threshold = 0.95; // Higher threshold so only very bright things glow
    bloomPass.strength = 0.5; // Modest glow
    bloomPass.radius = 0.3;

    const outputPass = new OutputPass();

    composer = new EffectComposer(renderer, renderTarget);
    composer.addPass(renderScene);
    composer.addPass(ssaoPass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass); // Applies tone mapping & color space conversion correctly

    // --- LIGHTS ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); // Higher ambient for a flatter, low-poly cartoon look
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0); // Extremely bright sun
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;

    // Better shadow resolution for cleaner look
    dirLight.shadow.mapSize.width = 8192; // Higher resolution
    dirLight.shadow.mapSize.height = 8192;
    dirLight.shadow.camera.top = 300;
    dirLight.shadow.camera.bottom = -300;
    dirLight.shadow.camera.left = -300;
    dirLight.shadow.camera.right = 300;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 1000;
    dirLight.shadow.bias = -0.0001; // Tweak to prevent shadow acne
    scene.add(dirLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4); // Subtle bounce light
    scene.add(hemiLight);

    // --- CANNON-ES SETUP ---
    world = new CANNON.World({
        gravity: new CANNON.Vec3(0, -9.82, 0), // m/s²
    });
    // Default material interactions
    const defaultMaterial = new CANNON.Material('default');
    const defaultContactMaterial = new CANNON.ContactMaterial(defaultMaterial, defaultMaterial, {
        friction: 0.1,
        restitution: 0.0
    });
    world.addContactMaterial(defaultContactMaterial);

    // --- CONTROLS ---
    controls = new PointerLockControls(camera, document.body);

    // Track mouse movement for weapon sway
    document.addEventListener('mousemove', (event) => {
        if (controls.isLocked && currentMode === 'weapon') {
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

    // Jump logic detection
    canJump = false;
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

        // If contactNormal.dot(upAxis) is between 0 and 1, we know that the contact normal is somewhat in the up direction.
        if(contactNormal.dot(upAxis) > 0.5) { // Use a "non-strict" equality here (e.g., > 0.5) to allow jumping on ramps.
            canJump = true;
        }
    });

    // We defer resetting canJump to allow it to be true during jump key processing.
    // However, if we don't have active collisions in the preStep, we should assume we're not grounded.
    world.addEventListener('preStep', () => {
        canJump = false;
    });

    // --- WEAPONS SYSTEM ---
    gunMesh = new THREE.Group();

    // Materials (Enhanced V9)
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x111115, roughness: 0.2, metalness: 0.9, flatShading: true });
    const greyPolymer = new THREE.MeshStandardMaterial({ color: 0x2A2A30, roughness: 0.6, metalness: 0.4, flatShading: true });

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
    const arSightGlass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), new THREE.MeshStandardMaterial({color: 0x00ffcc, transparent: true, opacity: 0.4, emissive: 0x00ffcc, emissiveIntensity: 0.5})); arSightGlass.position.set(0, 0.15, 0.05);
    arMesh.add(arReceiver, arBarrel, arHandguard, arStock, arMag, arGrip, arRail, arSightGlass);

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

    // Muzzle Flash light
    const muzzleFlash = new THREE.PointLight(0xffffff, 0, 5);
    muzzleFlash.position.set(0, 0.02, -0.75);
    muzzleFlash.name = "muzzleFlash";

    gunMesh.add(arMesh);
    gunMesh.add(smgMesh);
    gunMesh.add(sgMesh);
    gunMesh.add(muzzleFlash);

    // Default to AR
    arMesh.visible = true;
    smgMesh.visible = false;
    sgMesh.visible = false;

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
    }

    scene.background = new THREE.Color(skyColor);
    scene.fog = new THREE.FogExp2(fogColor, fogDensity);

    // Dynamic Sky System (Graphics V9)
    if (currentMap !== 'space' && currentMap !== 'platform' && currentMap !== 'lava') {
        const sky = new Sky();
        sky.scale.setScalar(450000);

        const phi = THREE.MathUtils.degToRad(90 - 20); // Elevation
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

        scene.add(sky);
        // Sun light to match sky sun
        dirLight.position.copy(sunPosition).multiplyScalar(100);
        dirLight.intensity = 1.2; // Softer sun for dynamic sky maps
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

    // Instead of realistic env map, use a simple ambient/hemisphere mix
    scene.environment = null;
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
    } else if (currentMap === 'island' || currentMap === 'desert') {
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
    }

    const groundTex = new THREE.CanvasTexture(groundCanvas);
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(groundSize / GRID_SIZE, groundSize / GRID_SIZE);
    groundTex.magFilter = THREE.NearestFilter;
    groundTex.minFilter = THREE.NearestMipmapLinearFilter;

    // We can use the same canvas to generate a crude bump map based on brightness.
    // For a real game, you'd draw a separate bump map. For here, using the color map
    // as a bump map works well enough because lines are bright (high) and bases are dark (low).

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
        } else if (currentMap === 'lava') {
            // Jagged rocks and sunken lava pits
            y = Math.sin(x * 0.1) * Math.sin(z * 0.1) * 3;
            if (y < 0) y *= 2; // Deeper pits
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
        roughness: (currentMap === 'lava' || currentMap === 'space') ? 0.4 : 1.0,
        metalness: currentMap === 'space' ? 0.8 : 0.0,
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
            case 'Digit1': setMode('ar'); break;
            case 'Digit2': setMode('smg'); break;
            case 'Digit3': setMode('shotgun'); break;
            case 'Digit4': setMode('wall'); break;
            case 'Digit5': setMode('floor'); break;
            case 'Digit6': setMode('ramp'); break;
            case 'Digit7': setMode('heal'); break;
        }
    });

    document.addEventListener('mousedown', (event) => {
        if (!controls.isLocked) return;

        const isWeapon = currentMode === 'ar' || currentMode === 'smg' || currentMode === 'shotgun';

        if (event.button === 0) { // Left click
            if (currentMode === 'heal') {
                useHeal();
            } else if (!isWeapon && (ghostMesh.visible || ghostRampMesh.visible)) {
                placeBuilding();
            } else if (isWeapon) {
                shoot();
            }
        } else if (event.button === 2) { // Right click
            if (!isWeapon) {
                placementRotation = (placementRotation + 1) % 4;
            }
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

    world.addBody(body);
    builtObjects.push({ mesh, body, id: data.id });
}

function createParticles(position, type = 'spark', count = 10) {
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

        // Random velocity
        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * (type === 'spark' ? 10 : 5),
            Math.random() * (type === 'spark' ? 5 : 8) + 2,
            (Math.random() - 0.5) * (type === 'spark' ? 10 : 5)
        );

        scene.add(mesh);

        particles.push({
            mesh: mesh,
            velocity: velocity,
            life: 1.0, // 1 second lifetime
            decay: type === 'spark' ? 2.0 : 1.0 // Spark fades faster
        });
    }
}

function useHeal() {
    if (isSpectator) return;
    if (health <= 0 || health >= 100) return;

    // Optimistically update health
    health = Math.min(100, health + 25);
    document.getElementById('healthBar').style.width = Math.max(0, health) + '%';
    document.getElementById('healthText').innerText = `${health} HP`;

    // Let server know
    socket.emit('useHeal', { amount: 25 });

    // Switch back to weapon immediately after healing
    setMode('ar');
}

function shoot() {
    if (isSpectator) return;
    if (health <= 0) return; // Dead players can't shoot

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
    }

    // Visual recoil & muzzle flash animation
    gunMesh.position.z = baseGunPosition.z + kickback; // Kickback
    gunMesh.rotation.x = muzzleClimb; // Upward muzzle climb

    const flash = gunMesh.getObjectByName("muzzleFlash");
    if (flash) flash.intensity = 15;

    setTimeout(() => {
        gunMesh.position.z = baseGunPosition.z;
        gunMesh.rotation.x = 0;
        if (flash) flash.intensity = 0;
    }, 100);

    const raycaster = new THREE.Raycaster();
    const center = new THREE.Vector2(0, 0); // crosshair center
    raycaster.setFromCamera(center, camera);

    // Objects to shoot: built objects AND other players
    const objectsToHit = builtObjects.map(obj => obj.mesh);
    for (let id in otherPlayers) {
        objectsToHit.push(otherPlayers[id].hitbox);
    }

    const intersects = raycaster.intersectObjects(objectsToHit);

    // Visual hitmarker simple effect
    document.getElementById('crosshair').style.backgroundColor = 'red';
    setTimeout(() => { document.getElementById('crosshair').style.backgroundColor = 'transparent'; }, 50);

    if (intersects.length > 0) {
        const hit = intersects[0];
        const hitMesh = hit.object;

        // Spawn sparks at hit point
        createParticles(hit.point, 'spark', 5);

        if (hitMesh.userData) {
            if (hitMesh.userData.isPlayer) {
                // Hit another player
                socket.emit('playerHit', { targetId: hitMesh.userData.id, damage: damage });
            } else if (hitMesh.userData.isBuilding) {
                // Tell server we hit a building
                if (socket && hitMesh.userData.id) {
                    socket.emit('hitObject', { objId: hitMesh.userData.id });
                }
            }
        }
    }
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
    currentMode = mode;

    // Toggle weapon visibility
    const isWeapon = mode === 'ar' || mode === 'smg' || mode === 'shotgun';
    if (gunMesh) {
        gunMesh.visible = isWeapon;
        if (isWeapon) {
            gunMesh.children.forEach(c => {
                if (c.name === 'ar' || c.name === 'smg' || c.name === 'shotgun') {
                    c.visible = (c.name === mode);
                }
            });
        }
    }

    // Update UI
    let displayMode = mode === 'ar' ? 'Assault Rifle' : mode === 'smg' ? 'SMG' : mode === 'shotgun' ? 'Shotgun' : mode;
    document.getElementById('modeDisplay').innerText = `Mode: ${displayMode.charAt(0).toUpperCase() + displayMode.slice(1)}`;
    document.querySelectorAll('.slot').forEach(el => el.classList.remove('active'));

    if(mode === 'ar') document.getElementById('slot-1').classList.add('active');
    if(mode === 'smg') document.getElementById('slot-2').classList.add('active');
    if(mode === 'shotgun') document.getElementById('slot-3').classList.add('active');
    if(mode === 'wall') document.getElementById('slot-4').classList.add('active');
    if(mode === 'floor') document.getElementById('slot-5').classList.add('active');
    if(mode === 'ramp') document.getElementById('slot-6').classList.add('active');
    if(mode === 'heal') document.getElementById('slot-7').classList.add('active');

    // Reset rotation on mode switch
    placementRotation = 0;
}

function placeBuilding() {
    let activeGhost = currentMode === 'ramp' ? ghostRampMesh : ghostMesh;

    let geo;
    let shape;

    if (currentMode === 'wall') {
        geo = new THREE.BoxGeometry(GRID_SIZE, GRID_SIZE, 0.5);
        shape = new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, GRID_SIZE/2, 0.25));
    } else if (currentMode === 'floor') {
        geo = new THREE.BoxGeometry(GRID_SIZE, 0.5, GRID_SIZE);
        shape = new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, 0.25, GRID_SIZE/2));
    } else if (currentMode === 'ramp') {
        // Simple approximation for cannon.js physics for ramp (using a box rotated)
        geo = ghostRampMesh.geometry.clone(); // Re-use the extrude geometry
        shape = new CANNON.Box(new CANNON.Vec3(GRID_SIZE/2, 0.5, Math.sqrt(GRID_SIZE*GRID_SIZE * 2)/2));
    }

    const mesh = new THREE.Mesh(geo, buildMaterial);
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

    world.addBody(body);

    builtObjects.push({ mesh, body, id: tempId, isTemp: true });
}

function updateGhostPlacement() {
    if (currentMode === 'weapon') {
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
    } else if (currentMode === 'floor') {
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
    if(composer) composer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

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

    // Update Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        // Gravity
        p.velocity.y -= 9.8 * delta;

        p.mesh.position.addScaledVector(p.velocity, delta);
        p.mesh.rotation.x += p.velocity.x * delta;
        p.mesh.rotation.y += p.velocity.y * delta;

        p.life -= p.decay * delta;

        if (p.mesh.material === sparkMat) {
             p.mesh.scale.setScalar(p.life); // Shrink sparks
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
             playerBody.velocity.x = moveDir.x * speed;
             playerBody.velocity.z = moveDir.z * speed;
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
    let targetCameraY = 0.5; // Base eye level

    if (controls.isLocked) {
        // Calculate player speed in XZ plane
        const currentSpeed = Math.sqrt(playerBody.velocity.x**2 + playerBody.velocity.z**2);

        // Only bob if moving and on the ground
        if (currentSpeed > 0.1 && canJump) {
            bobTimer += delta * 10.0;
            // Bob formula: sine wave based on time * speed
            targetCameraY = 0.5 + Math.sin(bobTimer) * 0.08;

            // Gun bobs with camera but slightly offset
            if (currentMode === 'weapon') {
                gunMesh.position.y = baseGunPosition.y + Math.sin(bobTimer * 2) * 0.02;
                gunMesh.position.x = baseGunPosition.x + Math.cos(bobTimer) * 0.02;
            }
        } else {
            bobTimer = 0; // Reset when standing still
            // Slowly return gun to base rest position
            if (currentMode === 'weapon') {
                gunMesh.position.y = THREE.MathUtils.lerp(gunMesh.position.y, baseGunPosition.y, delta * 10);
                gunMesh.position.x = THREE.MathUtils.lerp(gunMesh.position.x, baseGunPosition.x, delta * 10);
            }
        }

        // Weapon Sway interpolation
        if (currentMode === 'weapon') {
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

    // Use composer instead of renderer for bloom
    composer.render();
}
