import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
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

// Create a simple procedural grid texture for buildings (Sci-Fi Neon)
const canvas = document.createElement('canvas');
canvas.width = 256; canvas.height = 256;
const ctx = canvas.getContext('2d');
// Base dark metal
ctx.fillStyle = '#111118';
ctx.fillRect(0, 0, 256, 256);
// Neon grid lines
ctx.strokeStyle = '#00ffcc';
ctx.lineWidth = 2;
ctx.shadowColor = '#00ffcc';
ctx.shadowBlur = 10;
ctx.strokeRect(0, 0, 256, 256);

// Inner cross
ctx.beginPath();
ctx.moveTo(128, 0); ctx.lineTo(128, 256);
ctx.moveTo(0, 128); ctx.lineTo(256, 128);
ctx.stroke();

const gridTexture = new THREE.CanvasTexture(canvas);
gridTexture.wrapS = THREE.RepeatWrapping;
gridTexture.wrapT = THREE.RepeatWrapping;
gridTexture.repeat.set(1, 1);

const buildMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: gridTexture,
    metalness: 0.8,
    roughness: 0.2,
    emissive: 0x00ffcc,
    emissiveMap: gridTexture,
    emissiveIntensity: 1.5 // Increased to pierce the higher bloom threshold
});

const ghostMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.2, depthWrite: false });
let ghostMesh;
let ghostRampMesh; // Separate mesh needed for ramp rotation visually
let builtObjects = [];
let placementRotation = 0; // 0, 1, 2, 3 (* 90 degrees)

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
document.getElementById('playBtn').addEventListener('click', () => {
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

function initNetwork() {
    socket = io();

    socket.on('initGame', (data) => {
        myId = data.socketId;

        socket.emit('joinMap', currentMap);

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
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.3; // Darker baseline exposure to prevent flashbang
    document.body.appendChild(renderer.domElement);

    // --- POST-PROCESSING (BLOOM) ---
    // Use WebGLRenderTarget with MSAA to prevent jagged edges with post-processing
    const renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
        samples: 4, // 4x MSAA
        type: THREE.HalfFloatType // Better HDR precision
    });

    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 2.0; // Very high threshold so the sun/sky never glows
    bloomPass.strength = 1.5; // Stronger glow on neon elements to compensate
    bloomPass.radius = 0.5;

    const outputPass = new OutputPass();

    composer = new EffectComposer(renderer, renderTarget);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    composer.addPass(outputPass); // Applies tone mapping & color space conversion correctly

    // --- LIGHTS ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2); // Keep ambient low to emphasize shadows and emissive glow
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.4); // Clean sunlight
    dirLight.position.set(50, 100, 20);
    dirLight.castShadow = true;

    // Better shadow resolution
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.top = 150;
    dirLight.shadow.camera.bottom = -150;
    dirLight.shadow.camera.left = -150;
    dirLight.shadow.camera.right = 150;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 500;
    dirLight.shadow.bias = -0.001; // Reduce shadow acne
    scene.add(dirLight);

    const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x4CAF50, 0.3); // Sky color, ground color
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

    // Jump logic detection (simple grounded check)
    world.addEventListener('postStep', () => {
        // Simple check if player is falling or on ground
        if (Math.abs(playerBody.velocity.y) < 0.1) {
            canJump = true;
        } else {
            canJump = false;
        }
    });

    // --- WEAPON MESH ---
    gunMesh = new THREE.Group();

    const gunBarrelGeo = new THREE.BoxGeometry(0.08, 0.08, 0.6);
    const gunBodyGeo = new THREE.BoxGeometry(0.1, 0.15, 0.4);
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.8 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 2.0 });

    const barrel = new THREE.Mesh(gunBarrelGeo, gunMat);
    barrel.position.z = -0.2;

    const bodyMesh = new THREE.Mesh(gunBodyGeo, gunMat);
    bodyMesh.position.z = 0.1;

    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.15), accentMat);
    scope.position.set(0, 0.1, 0.1);

    // Muzzle Flash light
    const muzzleFlash = new THREE.PointLight(0x00ffcc, 0, 5); // neon cyan flash
    muzzleFlash.position.set(0, 0, -0.6);
    muzzleFlash.name = "muzzleFlash";

    gunMesh.add(barrel);
    gunMesh.add(bodyMesh);
    gunMesh.add(scope);
    gunMesh.add(muzzleFlash);

    // Position relative to camera
    gunMesh.position.copy(baseGunPosition);
    camera.add(gunMesh);
    scene.add(camera); // Camera needs to be in scene for children to render

    // --- SKY DOME ---
    const sky = new Sky();
    sky.scale.setScalar(10000);
    scene.add(sky);

    const sun = new THREE.Vector3();

    const uniforms = sky.material.uniforms;
    // Lower rayleigh so the sky isn't inherently glowing white
    uniforms['turbidity'].value = 10;
    uniforms['rayleigh'].value = 0.5; // Lower means less overall sky brightness
    uniforms['mieCoefficient'].value = 0.005; // Diffuses the sun disc
    uniforms['mieDirectionalG'].value = 0.7; // Reduces harsh sun glare

    let elevation = 45; // Put the sun higher in the sky so you don't look directly at it easily
    let azimuth = 180;

    // --- MAP GENERATION ---
    // Ground setup depends on the selected map
    let groundColor = 0x4CAF50; // default green
    let groundSize = 200;

    // Tone down the fog to prevent it from washing out the scene
    scene.fog = new THREE.FogExp2(0x4488aa, 0.002); // Darker blue fog, less dense

    if (currentMap === 'island') {
        groundColor = 0xE6D0AB; // Sand color
        groundSize = 100; // Smaller area
        elevation = 60; // Brighter sun
        scene.fog = new THREE.FogExp2(0x4488aa, 0.005);
    } else if (currentMap === 'platform') {
        groundColor = 0x333333; // Dark grey
        groundSize = 50; // Very small
        elevation = -5; // Sunset / twilight
        scene.fog = new THREE.FogExp2(0x222222, 0.010);
    }

    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    sun.setFromSphericalCoords(1, phi, theta);

    sky.material.uniforms['sunPosition'].value.copy(sun);

    // Sync directional light (sun) to sky position
    dirLight.position.copy(sun).multiplyScalar(50);
    dirLight.intensity = 0.4; // Less intense direct sunlight

    // Lower exposure to compensate for overall brightness
    renderer.toneMappingExposure = 0.3; // keep matching baseline

    // Generate Environment map from Sky so metals reflect the sky perfectly
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    // Render the scene as an environment map (without objects, just sky and light)
    let envMap = pmremGenerator.fromScene(scene).texture;
    scene.environment = envMap; // Apply to all standard materials

    // Three.js Ground
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
    const groundMat = new THREE.MeshStandardMaterial({ color: groundColor, roughness: 0.5, metalness: 0.05 });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Add grid helper to the ground to make distance judging easier
    const gridHelper = new THREE.GridHelper(groundSize, groundSize / GRID_SIZE, 0xffffff, 0xffffff);
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    gridHelper.position.y = 0.01; // slightly above ground to prevent z-fighting
    scene.add(gridHelper);

    // Cannon-es Ground
    // Use a box instead of a plane so you can fall off 'island' and 'platform'
    const groundShape = new CANNON.Box(new CANNON.Vec3(groundSize/2, 1, groundSize/2));
    const groundBody = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: groundShape,
        material: defaultMaterial,
        position: new CANNON.Vec3(0, -1, 0) // Shift down so top is at y=0
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
        if (!controls.isLocked) return;

        // Mode switching
        switch(event.code) {
            case 'Digit1': setMode('weapon'); break;
            case 'Digit2': setMode('wall'); break;
            case 'Digit3': setMode('floor'); break;
            case 'Digit4': setMode('ramp'); break;
        }
    });

    document.addEventListener('mousedown', (event) => {
        if (!controls.isLocked) return;

        if (event.button === 0) { // Left click
            if (currentMode !== 'weapon' && (ghostMesh.visible || ghostRampMesh.visible)) {
                placeBuilding();
            } else if (currentMode === 'weapon') {
                shoot();
            }
        } else if (event.button === 2) { // Right click
            if (currentMode !== 'weapon') {
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
    }

    const mesh = new THREE.Mesh(geo, buildMaterial);
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

function shoot() {
    if (health <= 0) return; // Dead players can't shoot

    // Visual recoil & muzzle flash animation
    gunMesh.position.z = -0.3;
    gunMesh.rotation.x = Math.PI / 8;

    const flash = gunMesh.getObjectByName("muzzleFlash");
    if (flash) flash.intensity = 15;

    setTimeout(() => {
        gunMesh.position.z = -0.5;
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
                socket.emit('playerHit', { targetId: hitMesh.userData.id, damage: 35 });
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
    if (gunMesh) {
        gunMesh.visible = (mode === 'weapon');
    }

    // Update UI
    document.getElementById('modeDisplay').innerText = `Mode: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
    document.querySelectorAll('.slot').forEach(el => el.classList.remove('active'));

    if(mode === 'weapon') document.getElementById('slot-1').classList.add('active');
    if(mode === 'wall') document.getElementById('slot-2').classList.add('active');
    if(mode === 'floor') document.getElementById('slot-3').classList.add('active');
    if(mode === 'ramp') document.getElementById('slot-4').classList.add('active');

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
