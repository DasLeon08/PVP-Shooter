import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- Globals ---
let camera, scene, renderer;
let world;
let controls;
let playerBody;

// Build System State
let currentMode = 'weapon'; // weapon, wall, floor, ramp
const GRID_SIZE = 5;
const buildMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.8 }); // Wood-ish
const ghostMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5, depthWrite: false });
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

init();
animate();

function init() {
    // --- THREE.JS SETUP ---
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky blue
    scene.fog = new THREE.Fog(0x87CEEB, 20, 100);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // --- LIGHTS ---
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6); // Soft white light
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 200, 50);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 100;
    dirLight.shadow.camera.bottom = -100;
    dirLight.shadow.camera.left = -100;
    dirLight.shadow.camera.right = 100;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 500;
    scene.add(dirLight);

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

    // --- GROUND ---
    // Three.js Ground
    const groundGeo = new THREE.PlaneGeometry(200, 200);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x4CAF50, roughness: 1 });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Cannon-es Ground
    const groundBody = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Plane(),
        material: defaultMaterial
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); // make it face up
    world.addBody(groundBody);

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

function shoot() {
    const raycaster = new THREE.Raycaster();
    const center = new THREE.Vector2(0, 0); // crosshair center
    raycaster.setFromCamera(center, camera);

    // Objects to shoot: only built objects (and maybe targets later, for now just buildings)
    const objectsToHit = builtObjects.map(obj => obj.mesh);
    const intersects = raycaster.intersectObjects(objectsToHit);

    // Visual recoil/flash simple effect
    document.getElementById('crosshair').style.backgroundColor = 'red';
    setTimeout(() => { document.getElementById('crosshair').style.backgroundColor = 'white'; }, 50);

    if (intersects.length > 0) {
        const hitMesh = intersects[0].object;

        // Apply damage
        if (hitMesh.userData && hitMesh.userData.isBuilding) {
            hitMesh.userData.health -= 35; // 3 shots to break (100 -> 65 -> 30 -> -5)

            // Visual feedback (flash red)
            const oldColor = hitMesh.material.color.getHex();
            hitMesh.material.color.setHex(0xff0000);
            setTimeout(() => {
                if (hitMesh && hitMesh.material) hitMesh.material.color.setHex(oldColor);
            }, 100);

            // Destroy if health <= 0
            if (hitMesh.userData.health <= 0) {
                destroyBuilding(hitMesh);
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

    // Add health data for shooting later
    mesh.userData = { isBuilding: true, health: 100 };

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

    builtObjects.push({ mesh, body });
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
}

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();

    if (controls.isLocked === true) {
        // Delta time
        const delta = (time - prevTime) / 1000;

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
    }
    prevTime = time;

    // Step physics world
    const timeStep = 1 / 60;
    world.step(timeStep);

    // Sync camera to physics body
    controls.getObject().position.copy(playerBody.position);
    // Offset camera slightly up to represent eye level (sphere radius is 0.5)
    controls.getObject().position.y += 0.5;

    renderer.render(scene, camera);
}
