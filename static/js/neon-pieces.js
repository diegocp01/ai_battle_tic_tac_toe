import * as THREE from 'three';

// Real game pieces in WebGL: each X and O is a solid, bevelled piece of brushed anodized metal with a thin
// neon tube mounted along its top. The tube lights the metal around it and the board beneath, and the piece
// casts one soft shadow away from the light at the top left. The SVG pieces stay in the DOM for screen readers
// and remain visible whenever WebGL is unavailable.
const board = document.getElementById('board');
const surface = board?.closest('.board-surface');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finish = {
    X: {metal: '#4a6aa8', gas: '#1a6dff', core: '#eef6ff'},
    O: {metal: '#a8322b', gas: '#ff2d1f', core: '#fff3ef'},
};
// Piece body: extruded depth plus a bevel on both faces, so it stands bevel + depth + bevel tall.
const body = {depth: .1, bevel: .035};
const height = body.depth + body.bevel * 2;
// Arm half-width and reach of the X, and the ring radii of the O, in board units (one cell = 1).
const arm = {half: .062, reach: .27};
const ring = {outer: .29, inner: .155};
const neonRadius = .026;
const decalSize = 1.6;
// A neon tube strikes with a few stutters before it holds steady.
const ignition = [0, .85, .1, .6, .05, 1, .7, 1];
const dropMs = 420, igniteDelayMs = 260, flickerStepMs = 70;
const unlitCore = new THREE.Color('#40434d');

if (board && surface) start();

function start() {
    const canvas = document.createElement('canvas');
    canvas.className = 'neon-layer';
    canvas.setAttribute('aria-hidden', 'true');
    let renderer;
    try {
        // Software-only WebGL is far too slow for this scene, so those browsers keep the SVG pieces.
        renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: true, failIfMajorPerformanceCaveat: true});
    } catch {
        return;
    }
    const gl = renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    if (/swiftshader|llvmpipe|software/i.test(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER))) {
        renderer.dispose();
        return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;

    // Looking straight down at a 3×3 board of unit cells, so the board plane lines up with the DOM grid
    // while perspective still shows the sides of pieces away from the centre.
    const fov = 40;
    const camera = new THREE.PerspectiveCamera(fov, 1, .1, 20);
    camera.position.set(0, 0, 1.5 / Math.tan(THREE.MathUtils.degToRad(fov / 2)));
    camera.lookAt(0, 0, 0);

    const scene = new THREE.Scene();
    scene.environment = studioEnvironment(renderer);
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(-2.6, 3, 4.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, {left: -2, right: 2, top: 2, bottom: -2, near: 1, far: 12});
    key.shadow.bias = -.0004;
    key.shadow.normalBias = .01;
    key.shadow.radius = 10;
    key.shadow.blurSamples = 16;
    const fill = new THREE.DirectionalLight(0xb8cfff, .5);
    fill.position.set(3, -2, 4);
    scene.add(key, fill, new THREE.AmbientLight(0xffffff, .2));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.ShadowMaterial({opacity: .5}));
    ground.receiveShadow = true;
    scene.add(ground);

    const shapes = {X: pieceShape('X'), O: pieceShape('O')};
    const tubes = {X: {sleeve: neonTubes('X', neonRadius), core: neonTubes('X', neonRadius * .45)}, O: {sleeve: neonTubes('O', neonRadius), core: neonTubes('O', neonRadius * .45)}};
    // Neon light on the board spreads wide; on the piece's own top it hugs the tube.
    const glowOnBoard = {X: decalTexture('X', [[30, 34, .45], [16, 14, .6]]), O: decalTexture('O', [[30, 34, .45], [16, 14, .6]])};
    const glowOnTop = {X: decalTexture('X', [[14, 10, .7], [6, 4, .8]]), O: decalTexture('O', [[14, 10, .7], [6, 4, .8]])};
    const brushed = brushedTexture();
    const decal = new THREE.PlaneGeometry(decalSize, decalSize);
    const pieces = new Map();
    let running = false;

    function buildPiece(mark) {
        const colors = finish[mark];
        const metal = new THREE.MeshPhysicalMaterial({color: colors.metal, metalness: .7, roughness: .34, roughnessMap: brushed, bumpMap: brushed, bumpScale: .35, clearcoat: .5, clearcoatRoughness: .18, envMapIntensity: 1.9});
        const sleeve = new THREE.MeshStandardMaterial({color: colors.gas, emissive: colors.gas, roughness: .15, metalness: 0});
        const core = new THREE.MeshBasicMaterial({color: colors.core, toneMapped: false});
        const topGlow = new THREE.MeshBasicMaterial({map: glowOnTop[mark], color: colors.gas, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false});
        const boardGlow = new THREE.MeshBasicMaterial({map: glowOnBoard[mark], color: colors.gas, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false});

        const solid = new THREE.Mesh(shapes[mark], metal);
        solid.position.z = body.bevel;
        solid.castShadow = true;
        const neon = new THREE.Group();
        for (const geometry of tubes[mark].sleeve) neon.add(new THREE.Mesh(geometry, sleeve));
        for (const geometry of tubes[mark].core) neon.add(new THREE.Mesh(geometry, core));
        neon.position.z = height + neonRadius * .35;
        const litTop = new THREE.Mesh(decal, topGlow);
        litTop.position.z = height + .002;
        const piece = new THREE.Group();
        piece.add(solid, neon, litTop);

        const underGlow = new THREE.Mesh(decal, boardGlow);
        underGlow.position.z = .002;
        const root = new THREE.Group();
        root.add(underGlow, piece);
        return {mark, root, piece, materials: [metal, sleeve, core, topGlow, boardGlow], sleeve, core, topGlow, boardGlow, colors, winner: false};
    }

    function createPiece(mark, coord, animate) {
        const piece = buildPiece(mark);
        piece.root.position.set('ABC'.indexOf(coord[0]) - 1, 2 - Number(coord[1]), 0);
        Object.assign(piece, {born: performance.now(), animate});
        setBrightness(piece, animate ? 0 : 1);
        scene.add(piece.root);
        return piece;
    }

    function removePiece(piece) {
        piece.root.removeFromParent();
        for (const material of piece.materials) material.dispose();
    }

    function setBrightness(piece, level) {
        const lit = level * (piece.winner ? 1.3 : 1);
        piece.core.color.copy(unlitCore).lerp(new THREE.Color(piece.colors.core), Math.min(level, 1));
        piece.sleeve.emissiveIntensity = 2.6 * lit;
        piece.topGlow.opacity = .55 * lit;
        piece.boardGlow.opacity = .5 * lit;
    }

    // The player chips show the same lit pieces, rendered once into images before the board needs the canvas.
    // They are posed off the board in the same scene, so the board reuses the lighting and compiled shaders.
    function renderPortraits() {
        const offBoard = 10;
        const lens = new THREE.PerspectiveCamera(fov, 1, .1, 10);
        lens.position.set(offBoard, 0, .5 / Math.tan(THREE.MathUtils.degToRad(fov / 2)) + height);
        lens.lookAt(offBoard, 0, 0);
        renderer.setPixelRatio(1);
        renderer.setSize(192, 192, false);
        for (const mark of ['X', 'O']) {
            const piece = buildPiece(mark);
            setBrightness(piece, 1);
            piece.boardGlow.opacity = 0;
            piece.root.position.x = offBoard;
            scene.add(piece.root);
            renderer.render(scene, lens);
            document.documentElement.style.setProperty(`--neon-${mark.toLowerCase()}`, `url("${canvas.toDataURL()}")`);
            removePiece(piece);
        }
        document.documentElement.classList.add('neon-marks');
    }

    function frame(now) {
        let busy = false;
        for (const piece of pieces.values()) {
            if (!piece.animate) continue;
            const elapsed = now - piece.born;
            const drop = Math.min(elapsed / dropMs, 1);
            piece.piece.position.z = (1 - bounce(drop)) * .9;
            const step = Math.floor((elapsed - igniteDelayMs) / flickerStepMs);
            setBrightness(piece, step < 0 ? 0 : ignition[Math.min(step, ignition.length - 1)]);
            if (step < ignition.length) busy = true;
            else piece.animate = false;
        }
        renderer.render(scene, camera);
        if (busy) requestAnimationFrame(frame);
        else running = false;
    }

    function requestRender() {
        if (running || !canvas.width) return;
        running = true;
        requestAnimationFrame(frame);
    }

    function sync() {
        for (const cell of board.querySelectorAll('.cell')) {
            const coord = cell.dataset.coord;
            const mark = cell.classList.contains('X') ? 'X' : cell.classList.contains('O') ? 'O' : null;
            let piece = pieces.get(coord);
            if (piece && piece.mark !== mark) {
                removePiece(piece);
                pieces.delete(coord);
                piece = null;
            }
            if (!piece && mark) {
                piece = createPiece(mark, coord, cell.classList.contains('new-move') && !reducedMotion.matches);
                pieces.set(coord, piece);
            }
            if (piece && piece.winner !== cell.classList.contains('winner')) {
                piece.winner = !piece.winner;
                if (!piece.animate) setBrightness(piece, 1);
            }
        }
        requestRender();
    }

    renderPortraits();
    new ResizeObserver(() => {
        const size = surface.clientWidth;
        if (!size) return;
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        renderer.setSize(size, size, false);
        requestRender();
    }).observe(surface);
    new MutationObserver(sync).observe(board, {subtree: true, childList: true, attributes: true, attributeFilter: ['class']});

    surface.appendChild(canvas);
    surface.classList.add('has-neon');
    sync();
}

// The flat outline of each piece, extruded into a solid with rounded, bevelled edges.
function pieceShape(mark) {
    const shape = new THREE.Shape();
    if (mark === 'O') {
        shape.absarc(0, 0, ring.outer, 0, Math.PI * 2, false);
        const hole = new THREE.Path();
        hole.absarc(0, 0, ring.inner, 0, Math.PI * 2, true);
        shape.holes.push(hole);
    } else {
        // A plus sign with rounded arm ends, turned 45° into an X.
        const {half: w, reach: l} = arm;
        shape.moveTo(w, w);
        shape.lineTo(w, l);
        shape.absarc(0, l, w, 0, Math.PI, false);
        shape.lineTo(-w, w);
        shape.lineTo(-l, w);
        shape.absarc(-l, 0, w, Math.PI / 2, Math.PI * 1.5, false);
        shape.lineTo(-w, -w);
        shape.lineTo(-w, -l);
        shape.absarc(0, -l, w, Math.PI, Math.PI * 2, false);
        shape.lineTo(w, -w);
        shape.lineTo(l, -w);
        shape.absarc(l, 0, w, -Math.PI / 2, Math.PI / 2, false);
        shape.closePath();
    }
    const geometry = new THREE.ExtrudeGeometry(shape, {depth: body.depth, bevelEnabled: true, bevelThickness: body.bevel, bevelSize: .03, bevelSegments: 8, curveSegments: 64});
    if (mark === 'X') geometry.rotateZ(Math.PI / 4);
    return geometry;
}

// The neon tube runs along the middle of the piece's top face.
function neonTubes(mark, radius) {
    if (mark === 'O') return [new THREE.TorusGeometry((ring.outer + ring.inner) / 2, radius, 24, 160)];
    return [Math.PI / 4, -Math.PI / 4].map(angle => new THREE.CapsuleGeometry(radius, arm.reach * 2, 8, 24).rotateZ(angle));
}

function tracePiece(mark, unit) {
    const path = new Path2D();
    if (mark === 'O') path.arc(0, 0, (ring.outer + ring.inner) / 2 * unit, 0, Math.PI * 2);
    else {
        const tip = arm.reach * Math.SQRT1_2 * unit;
        path.moveTo(-tip, -tip);
        path.lineTo(tip, tip);
        path.moveTo(tip, -tip);
        path.lineTo(-tip, tip);
    }
    return path;
}

// A soft, white image of the piece's tube path; used for the neon light it throws.
function decalTexture(mark, layers) {
    const size = 256, unit = size / decalSize;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    context.translate(size / 2, size / 2);
    const path = tracePiece(mark, unit);
    context.lineCap = 'round';
    context.strokeStyle = '#fff';
    context.shadowColor = '#fff';
    for (const [width, blur, alpha] of layers) {
        context.globalAlpha = alpha;
        context.lineWidth = width;
        context.shadowBlur = blur;
        context.stroke(path);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}


// Fine directional streaks, like brushed aluminium, for the metal's roughness and bump.
function brushedTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    context.fillStyle = '#808080';
    context.fillRect(0, 0, size, size);
    for (let i = 0; i < 2600; i++) {
        const shade = 90 + Math.random() * 80;
        context.strokeStyle = `rgb(${shade} ${shade} ${shade} / ${.15 + Math.random() * .35})`;
        context.lineWidth = .5 + Math.random();
        const y = Math.random() * size, x = Math.random() * size, length = 40 + Math.random() * 220;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + length, y + (Math.random() - .5) * 2);
        context.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 3);
    return texture;
}

// Soft studio lighting for the metal and glass to reflect: a dark room with a few bright strip lights.
function studioEnvironment(renderer) {
    const room = new THREE.Scene();
    room.add(new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({color: 0x0b1020, side: THREE.BackSide})));
    for (const [color, intensity, position, width, height] of [
        ['#ffffff', 7, [-3, 3, 4], 3.2, 1], ['#a9c8ff', 2.5, [3.2, -2, 3], 2, 2.4], ['#ffd8c2', 2, [0, 4, -2], 4, .8],
    ]) {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide}));
        strip.position.set(...position);
        strip.lookAt(0, 0, 0);
        room.add(strip);
    }
    const generator = new THREE.PMREMGenerator(renderer);
    const environment = generator.fromScene(room, .02).texture;
    generator.dispose();
    return environment;
}

function bounce(t) {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375;
    return n * (t -= 2.625 / d) * t + .984375;
}
