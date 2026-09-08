import * as THREE from 'three';
import { trackPoint, TRACK_LENGTH, rng } from './simulation.js';

const UP = new THREE.Vector3(0, 1, 0);
const sphereGeometry = new THREE.SphereGeometry(1, 16, 12);
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const materials = new Map();
function material(color, roughness = .8) {
  const key = `${color}-${roughness}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness }));
  return materials.get(key);
}
function ellipsoid(parent, color, x, y, z, sx, sy, sz) {
  const mesh = new THREE.Mesh(sphereGeometry, material(color));
  mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.castShadow = true;
  parent.add(mesh); return mesh;
}
function box(parent, color, x, y, z, sx, sy, sz) {
  const mesh = new THREE.Mesh(boxGeometry, material(color));
  mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function rod(parent, color, from, to, radius = .04) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 8), material(color));
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(UP, b.sub(a).normalize());
  mesh.castShadow = true; parent.add(mesh); return mesh;
}
function textTexture(text, foreground = '#ffffff', background = '#174837', width = 512, height = 128) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
  ctx.fillStyle = foreground; ctx.font = `600 ${height * .56}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, width / 2, height * .54);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function sign(parent, text, x, y, z, width, height, fg, bg) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: textTexture(text, fg, bg), side: THREE.DoubleSide }));
  mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
function ovalSurface(inner, outer, color, y, banded = false) {
  const vertices = [], indices = [], colors = [], segments = 480;
  const base = new THREE.Color(color);
  for (let i = 0; i <= segments; i++) {
    const d = i / segments * TRACK_LENGTH;
    const c = base.clone().multiplyScalar(banded && Math.floor(d / 12) % 2 ? .95 : 1);
    for (const lane of [inner, outer]) {
      const p = trackPoint(d, lane); vertices.push(p.x, y, p.z); colors.push(c.r, c.g, c.b);
    }
    if (i < segments) { const k = i * 2; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  mesh.receiveShadow = true; return mesh;
}

function createHorse(horse) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const coat = horse.coat, dark = '#261f1c', hoof = '#282c2a';
  ellipsoid(body, coat, 0, 1.69, -.1, .53, .6, 1.12);
  ellipsoid(body, coat, 0, 1.69, -.85, .52, .56, .6);
  ellipsoid(body, coat, 0, 1.82, .65, .48, .6, .51);
  const neck = new THREE.Group(); neck.position.set(0, 1.86, .63); body.add(neck);
  const n = ellipsoid(neck, coat, 0, .39, .22, .32, .76, .39); n.rotation.x = .45;
  ellipsoid(neck, coat, 0, .86, .66, .29, .35, .56).rotation.x = -.3;
  ellipsoid(neck, '#4b3c35', 0, .68, 1.03, .245, .225, .33);
  for (const side of [-1, 1]) {
    ellipsoid(neck, coat, side * .19, 1.2, .42, .09, .26, .095).rotation.x = -.18;
    ellipsoid(neck, '#151b18', side * .266, .91, .77, .041, .048, .055);
    ellipsoid(neck, '#bba795', side * .287, .917, .79, .012, .017, .015);
    ellipsoid(neck, '#24211e', side * .19, .73, 1.23, .038, .048, .024);
    rod(neck, dark, [side * .29, .62, 1.05], [side * .29, 1.01, .6], .028);
  }
  for (let i = 0; i < 10; i++) {
    ellipsoid(neck, dark, 0, i * .085 + .06, i * .052 - .13, .115, .13, .14);
  }
  ellipsoid(neck, dark, 0, 1.15, .54, .19, .1, .2);
  // White blaze, leather noseband and a fitted saddle cloth.
  if (horse.id % 3 !== 0) ellipsoid(neck, '#e8dfcd', 0, .965, 1.02, .07, .17, .047).rotation.x = -.6;
  const noseBand = new THREE.Mesh(new THREE.TorusGeometry(.235, .024, 6, 20), material(dark));
  noseBand.position.set(0, .71, 1.04); neck.add(noseBand);
  ellipsoid(body, horse.silk, 0, 2.13, -.13, .585, .22, .61);
  ellipsoid(body, '#292827', 0, 2.28, -.12, .41, .16, .43);
  for (const side of [-1, 1]) {
    const cloth = box(body, horse.silk, side * .51, 1.92, -.14, .05, .55, .81);
    cloth.rotation.z = side * -.1;
    const num = new THREE.Mesh(new THREE.PlaneGeometry(.48, .38), new THREE.MeshBasicMaterial({ map: textTexture(String(horse.id), horse.id === 1 || horse.id === 5 ? '#263b31' : '#ffffff', horse.silk, 128, 128), side: THREE.DoubleSide }));
    num.position.set(side * .551, 1.94, -.16); num.rotation.y = side * Math.PI / 2; body.add(num);
  }
  const legs = [];
  for (const front of [true, false]) for (const side of [-1, 1]) {
    const upper = new THREE.Group(); upper.position.set(side * .36, 1.53, front ? .73 : -.82); body.add(upper);
    ellipsoid(upper, coat, 0, -.28, -.025, front ? .14 : .195, .4, .175);
    const knee = new THREE.Group(); knee.position.set(0, -.68, 0); upper.add(knee);
    ellipsoid(knee, coat, 0, 0, 0, .12, .12, .12);
    ellipsoid(knee, horse.id % 2 ? '#d9cfbb' : coat, 0, -.28, .015, .071, .34, .08);
    ellipsoid(knee, hoof, 0, -.64, .075, .13, .115, .19);
    legs.push({ upper, knee, front, side });
  }
  const tail = new THREE.Group(); tail.position.set(0, 1.97, -1.08); tail.rotation.x = .45; body.add(tail);
  for (let i = 0; i < 5; i++) ellipsoid(tail, dark, 0, -.14 - i * .19, -.16 - i * .07, .14 - i * .012, .24, .17);
  const rider = new THREE.Group(); rider.position.set(0, 2.31, -.18); body.add(rider);
  ellipsoid(rider, '#e8e1d1', 0, .15, -.02, .26, .24, .24);
  const torso = ellipsoid(rider, horse.silk, 0, .47, .22, .285, .45, .22); torso.rotation.x = .67;
  ellipsoid(rider, '#e3c09a', 0, .83, .53, .17, .21, .175);
  ellipsoid(rider, horse.silk, 0, .985, .52, .225, .175, .225);
  ellipsoid(rider, '#23322c', 0, .95, .68, .225, .035, .17);
  box(rider, '#29332d', 0, .84, .693, .29, .07, .035);
  for (const side of [-1, 1]) {
    rod(rider, '#ede8dc', [side * .19, .12, -.02], [side * .47, -.24, .36], .13);
    rod(rider, '#262925', [side * .47, -.24, .36], [side * .46, -.69, .05], .09);
    ellipsoid(rider, '#202622', side * .46, -.68, .12, .095, .1, .19);
    rod(rider, horse.silk, [side * .23, .65, .28], [side * .32, .39, .57], .105);
    rod(rider, horse.silk, [side * .32, .39, .57], [side * .21, .31, .9], .082);
    ellipsoid(rider, '#efe8d8', side * .21, .31, .9, .085, .08, .09);
    const points = [[side * .21, 2.62, .72], [side * .36, 2.36, 1.09], [side * .26, 2.57, 1.63]].map(p => new THREE.Vector3(...p));
    const reins = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 10, .017, 5, false), material(dark)); body.add(reins);
  }
  const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(String(horse.id), '#ffffff', '#1c4337', 128, 128), depthTest: true }));
  badge.scale.set(.58, .58, 1); badge.position.set(0, 4, 0); root.add(badge);
  const marker = new THREE.Group(); root.add(marker);
  const ring = new THREE.Mesh(new THREE.RingGeometry(.83, .94, 40), new THREE.MeshBasicMaterial({ color: '#f6ce69', side: THREE.DoubleSide, transparent: true, opacity: .85 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .08; marker.add(ring);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(.19, .36, 4), material('#f6ce69'));
  arrow.rotation.z = Math.PI; arrow.position.y = 4.6; marker.add(arrow); marker.visible = false;
  // Soft contact shadow remains visible with real-time shadows disabled.
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const cx = cv.getContext('2d'); const gr = cx.createRadialGradient(32, 32, 3, 32, 32, 32);
  gr.addColorStop(0, 'rgba(17,35,19,.34)'); gr.addColorStop(1, 'rgba(17,35,19,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 3.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .055; root.add(shadow);
  return { root, body, neck, legs, rider, tail, marker, arrow, badge };
}

export class RaceScene {
  constructor(container, horses, quality, onError) {
    this.container = container; this.portrait = false; this.mode = 'broadcast'; this.selected = null; this.onError = onError;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#b5d7e0');
    this.scene.fog = new THREE.Fog('#bdd9d7', 150, 410);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '8頭の馬と騎手が走る3D芝コース');
    this.renderer.domElement.setAttribute('role', 'img'); container.prepend(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); onError('3D描画が中断されました。ページを再読み込みしてください。保存状況を確認してから再読み込みしてください。'); });
    this.camera = new THREE.PerspectiveCamera(47, 1, .2, 650);
    this.camera.position.set(23, 12, 65); this.look = new THREE.Vector3(-2, 1.4, 40);
    this.camera.lookAt(this.look);
    this.scene.add(new THREE.HemisphereLight('#e8f6ff', '#718a43', 1.8));
    this.sun = new THREE.DirectionalLight('#fff3d9', 2.6); this.sun.position.set(-40, 65, 35);
    this.sun.castShadow = true; this.sun.shadow.camera.left = -40; this.sun.shadow.camera.right = 40;
    this.sun.shadow.camera.top = 36; this.sun.shadow.camera.bottom = -36;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 160;
    this.sun.shadow.bias = -.0003; this.sun.shadow.normalBias = .04;
    this.scene.add(this.sun, this.sun.target);
    this.buildWorld(); this.setHorses(horses); this.setQuality(quality);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container); this.resize();
  }
  buildWorld() {
    const world = this.scene;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), material('#709b56'));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.06; ground.receiveShadow = true; world.add(ground);
    world.add(ovalSurface(-7.5, 7.5, '#52883d', .025, true));
    world.add(ovalSurface(7.55, 12, '#c6bc98', .01));
    world.add(ovalSurface(-9.5, -7.6, '#8faf65', .03));
    // Subtle grass grain, generated locally with a fixed seed.
    const random = rng(29183), data = new Uint8Array(128 * 128 * 4);
    for (let i = 0; i < data.length; i += 4) { const c = 155 + Math.floor(random() * 70); data[i] = c; data[i + 1] = c; data[i + 2] = c; data[i + 3] = 255; }
    const grain = new THREE.DataTexture(data, 128, 128); grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.repeat.set(300, 300); grain.needsUpdate = true;
    ground.material = new THREE.MeshStandardMaterial({ color: '#7aab5b', map: grain, roughness: 1 });
    for (let i = -8; i <= 8; i++) {
      const stripe = box(world, i % 2 ? '#7aab5b' : '#83b361', i * 7, -.03, 0, 7, .08, 51); stripe.castShadow = false;
    }
    for (const lane of [-7.6, 7.6]) {
      const count = 190, posts = new THREE.InstancedMesh(boxGeometry, material('#f2f0df'), count);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        const p = trackPoint(i / count * TRACK_LENGTH, lane);
        dummy.position.set(p.x, .71, p.z); dummy.scale.set(.11, 1.42, .11); dummy.updateMatrix(); posts.setMatrixAt(i, dummy.matrix);
      }
      posts.castShadow = true; world.add(posts);
      for (const y of [.7, 1.33]) {
        const points = Array.from({ length: 481 }, (_, i) => { const p = trackPoint(i / 480 * TRACK_LENGTH, lane); return new THREE.Vector3(p.x, y, p.z); });
        const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 600, .055, 5, true), material('#fcfaf0')); rail.castShadow = true; world.add(rail);
      }
    }
    // Start stalls, each with an independently hinged pair of doors.
    this.gate = new THREE.Group(); this.doors = []; world.add(this.gate);
    for (let i = 0; i < 8; i++) {
      const z = 40 + (i - 3.5) * 1.7;
      for (const side of [-1, 1]) {
        box(this.gate, '#e2e5d9', -3.15, 1.65, z + side * .8, .1, 3.3, .1);
        box(this.gate, '#e2e5d9', -.13, 1.65, z + side * .8, .1, 3.3, .1);
        box(this.gate, '#174a39', -1.64, 3.32, z + side * .8, 3.15, .14, .13);
        const door = new THREE.Group(); door.position.set(.02, 0, z + side * .8); this.gate.add(door);
        for (let k = 0; k < 4; k++) box(door, '#d4dfcd', 0, 1.0 + k * .34, -side * .38, .065, .055, .74);
        box(door, '#d4dfcd', 0, 1.54, -side * .76, .065, 1.15, .06);
        this.doors.push({ door, side });
      }
      const placard = sign(this.gate, String(i + 1), .01, 3.53, z, 1.35, .48, '#f3e8c7', '#184735'); placard.rotation.y = Math.PI / 2;
    }
    box(this.gate, '#174a39', -3.1, 3.87, 40, .75, .17, 14.35);
    // The physical finish plane is x=0; simulation distance is the horse's nose.
    for (const z of [31.3, 48.7]) {
      box(world, '#eeeade', 0, 2.8, z, .26, 5.6, .3);
      const disc = new THREE.Mesh(new THREE.TorusGeometry(.65, .1, 8, 32), material('#d4b46c')); disc.position.set(0, 5.4, z); disc.rotation.y = Math.PI / 2; world.add(disc);
      const f = sign(world, 'FINISH', 0, 4.35, z, 1.8, .48, '#183e30', '#f2eddd'); f.rotation.y = Math.PI / 2;
    }
    for (let i = 0; i < 28; i++) box(world, i % 2 ? '#edeedb' : '#355331', 0, .047, 33 + i * .5, .32, .02, .5).castShadow = false;
    // Tiered grandstand, seat rows, spectators and a floating roof.
    const stand = new THREE.Group(); world.add(stand);
    box(stand, '#dad6c5', 0, 2.2, -66, 108, 4.4, 17);
    for (let row = 0; row < 7; row++) {
      box(stand, '#c0c8bb', 0, 4 + row * .72, -58 - row * 2, 108, .7, 2.1);
      box(stand, row % 2 ? '#527a68' : '#3e6456', 0, 4.53 + row * .72, -58.5 - row * 2, 104, .55, .5);
    }
    const crowd = new THREE.InstancedMesh(sphereGeometry, material('#ffffff'), 420);
    const dummy = new THREE.Object3D(), colors = ['#ead6b3', '#c2d1c6', '#d5b575', '#51736b', '#bb826e', '#ece9d8'];
    for (let i = 0; i < 420; i++) {
      const row = Math.floor(i / 60), x = (i % 60 - 29.5) * 1.7;
      dummy.position.set(x, 4.8 + row * .72, -58.5 - row * 2); dummy.scale.set(.21, .34, .23); dummy.updateMatrix(); crowd.setMatrixAt(i, dummy.matrix); crowd.setColorAt(i, new THREE.Color(colors[Math.floor(random() * colors.length)]));
    }
    world.add(crowd);
    for (const x of [-50, -25, 0, 25, 50]) rod(world, '#e9e7d9', [x, 3, -73], [x, 12.8, -70], .18);
    box(world, '#f3eee0', 0, 12.8, -67, 115, .55, 24).rotation.x = -.075;
    box(world, '#264d3e', 0, 12.1, -54.8, 115, .8, .2);
    sign(world, 'V E R D A N T   T U R F   C L U B', 0, 3.1, -57.25, 49, 2, '#e9e1c2', '#1d4e3b');
    for (const x of [-36, 36]) sign(world, 'THE GREEN IS CALLING.', x, 2.6, -57.2, 19, 1, '#395d49', '#e5e4cd');
    // Infield pond and decorative planting.
    const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: '#67a9a1', roughness: .23, metalness: .22 }));
    pond.rotation.x = -Math.PI / 2; pond.position.set(40, .045, 0); pond.scale.set(15, 9, 1); world.add(pond);
    const centerSign = sign(world, 'VERDANT', -23, .15, 0, 32, 7, '#e1e6c4', '#77a458'); centerSign.rotation.x = -Math.PI / 2;
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.3, .45, 4, 6), material('#81765b'), 110);
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), material('#4f8055'), 110);
    for (let i = 0; i < 110; i++) {
      const a = i / 110 * Math.PI * 2, x = Math.cos(a) * (125 + random() * 35), z = Math.sin(a) * (92 + random() * 30);
      const s = 3 + random() * 2.8;
      dummy.position.set(x, 2, z); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.y = s + 2; dummy.scale.set(s, s * 1.35, s); dummy.rotation.y = a; dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
      crowns.setColorAt(i, new THREE.Color().setHSL(.28 + random() * .045, .24, .27 + random() * .12));
    }
    trunks.castShadow = true; crowns.castShadow = true; world.add(trunks, crowns);
    for (let i = 0; i < 9; i++) {
      const cloud = new THREE.Group(); cloud.position.set((i - 4) * 45, 48 + random() * 15, -150 - random() * 40);
      for (let j = 0; j < 4; j++) { const m = ellipsoid(cloud, '#e9f0e7', j * 6, random() * 2, 0, 8, 3.2, 4); m.castShadow = false; }
      world.add(cloud);
    }
    for (let i = 1; i <= 4; i++) {
      const p = trackPoint(TRACK_LENGTH * i / 5, -8.8);
      const marker = sign(world, String(1600 - i * 300), p.x, 1.8, p.z, 2.4, 1.1, '#315843', '#f0eddb'); marker.rotation.y = p.angle;
    }
  }
  setHorses(horses) {
    if (this.horses) this.horses.forEach(h => {
      this.scene.remove(h.root);
      h.root.traverse(o => {
        if (o.geometry && o.geometry !== sphereGeometry && o.geometry !== boxGeometry) o.geometry.dispose();
        if (o.material?.map) { o.material.map.dispose(); o.material.dispose(); }
      });
    });
    this.horses = horses.map(h => createHorse(h)); this.horses.forEach(h => this.scene.add(h.root));
  }
  setQuality(quality) {
    this.quality = quality; this.renderer.shadowMap.enabled = quality !== 'low';
    this.sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.75 : quality === 'medium' ? 1.2 : .85));
    this.scene.traverse(o => { if (o.material) { if (Array.isArray(o.material)) o.material.forEach(m => m.needsUpdate = true); else o.material.needsUpdate = true; } });
    this.resize();
  }
  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height);
  }
  update(samples, time, dt, racing, selected, raceTime = 0) {
    this.selected = selected;
    const leaderIndex = samples.reduce((best, h, i) => h.d > samples[best].d ? i : best, 0);
    const chosen = (selected || leaderIndex + 1) - 1;
    for (let i = 0; i < this.horses.length; i++) {
      const horse = this.horses[i], state = samples[i], p = trackPoint(state.d - 1.85, state.lane);
      horse.root.position.set(p.x, 0, p.z); horse.root.rotation.y = p.angle;
      const amplitude = Math.min(1, state.v / 9), phase = (racing ? state.d * 1.25 : time * 1.5) + i * .72;
      horse.body.position.y = amplitude * (.1 + Math.sin(phase * 2) * .085);
      horse.body.rotation.x = Math.sin(phase) * .033 * amplitude;
      horse.neck.rotation.x = Math.sin(phase - .5) * .045 * amplitude;
      // Keep the front of the animated muzzle on the simulated nose position.
      // This compensates for the body/neck pitch at the physical finish plane.
      const neckPitch = horse.neck.rotation.x, bodyPitch = horse.body.rotation.x;
      const muzzleY = 1.86 + .68 * Math.cos(neckPitch) - 1.03 * Math.sin(neckPitch);
      const muzzleZ = .63 + .68 * Math.sin(neckPitch) + 1.03 * Math.cos(neckPitch);
      const muzzleExtent = Math.hypot(.225 * Math.sin(neckPitch + bodyPitch), .33 * Math.cos(neckPitch + bodyPitch));
      const noseOffset = muzzleY * Math.sin(bodyPitch) + muzzleZ * Math.cos(bodyPitch) + muzzleExtent;
      const anchored = trackPoint(state.d - noseOffset, state.lane);
      horse.root.position.set(anchored.x, 0, anchored.z); horse.root.rotation.y = anchored.angle;
      for (const leg of horse.legs) {
        const a = phase + (leg.front ? 0 : 2.2) + (leg.side === 1 ? .68 : 0);
        leg.upper.rotation.x = Math.sin(a) * .72 * amplitude + (leg.front ? -.06 : .12) * amplitude;
        leg.knee.rotation.x = (leg.front ? -1 : 1) * Math.max(0, Math.cos(a + .7)) * 1.2 * amplitude;
      }
      horse.rider.position.y = 2.31 - Math.sin(phase * 2) * .055 * amplitude;
      horse.rider.rotation.x = .07 * amplitude + Math.sin(phase) * .055 * amplitude;
      horse.tail.rotation.x = .55 + amplitude * .45 + Math.sin(phase) * .12;
      horse.tail.rotation.z = Math.sin(time * 3 + i) * .16;
      horse.marker.visible = i === selected - 1;
      horse.arrow.position.y = 4.55 + Math.sin(time * 3) * .12;
      horse.badge.material.opacity = selected && selected !== i + 1 ? .76 : 1;
    }
    this.gate.visible = !this.portrait && (!racing || raceTime < 5);
    this.gate.position.y = racing ? -Math.max(0, raceTime - 1.4) * 4 : 0;
    this.doors.forEach(({ door, side }) => { door.rotation.y = racing ? side * Math.min(Math.PI * .48, raceTime * 5) : 0; });
    const focus = this.horses[chosen].root.position;
    const p = trackPoint(samples[chosen].d - 1.85, samples[chosen].lane);
    const targetPos = new THREE.Vector3(), targetLook = new THREE.Vector3();
    if (this.portrait) {
      targetPos.set(focus.x + 3, 4.2, focus.z + 11);
      targetLook.set(focus.x + .5, 1.7, focus.z);
    } else if (this.mode === 'follow') {
      targetPos.set(focus.x - p.dx * 11 + p.nx * 5, 6.5, focus.z - p.dz * 11 + p.nz * 5);
      targetLook.set(focus.x + p.dx * 4, 1.7, focus.z + p.dz * 4);
    } else if (this.mode === 'overhead') {
      const min = Math.min(...samples.map(s => s.d)), max = Math.max(...samples.map(s => s.d));
      const mid = trackPoint((min + max) / 2);
      const height = Math.min(130, Math.max(47, (max - min) * .8 + 35));
      targetPos.set(mid.x + 12, height, mid.z + 23); targetLook.set(mid.x, 0, mid.z);
    } else {
      const view = racing ? trackPoint(samples[leaderIndex].d - 1.85) : trackPoint(-1.85);
      const margin = this.camera.aspect < 1 ? 30 : racing ? 24 : 17;
      const forward = racing ? 18 : 14;
      const cameraHeight = racing ? (view.z < -28 && Math.abs(view.x) < 90 ? 21 : 9) : 7.2;
      targetPos.set(view.x + view.nx * margin + view.dx * forward, cameraHeight, view.z + view.nz * margin + view.dz * forward);
      targetLook.set(view.x - view.dx * 2, 1.25, view.z - view.dz * 2);
    }
    const blend = 1 - Math.exp(-dt * (racing ? 4.6 : 2.6));
    this.camera.position.lerp(targetPos, blend); this.camera.position.y = Math.max(5.5, this.camera.position.y);
    if (Math.abs(this.camera.position.x) < 60 && this.camera.position.z < -53 && this.camera.position.z > -83) this.camera.position.y = Math.max(15, this.camera.position.y);
    this.look.lerp(targetLook, blend); this.camera.lookAt(this.look);
    const sunTarget = this.mode === 'overhead' ? this.look : focus;
    this.sun.target.position.set(sunTarget.x, 0, sunTarget.z); this.sun.position.set(sunTarget.x - 35, 65, sunTarget.z + 30);
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.observer.disconnect();
    const geometries = new Set(), localMaterials = new Set(), textures = new Set();
    this.scene.traverse(object => {
      if (object.geometry && object.geometry !== sphereGeometry && object.geometry !== boxGeometry) geometries.add(object.geometry);
      const list = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
      for (const m of list) if (![...materials.values()].includes(m)) {
        localMaterials.add(m);
        for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const value of textures) value.dispose();
    for (const value of localMaterials) value.dispose();
    for (const value of geometries) value.dispose();
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
  }
}
