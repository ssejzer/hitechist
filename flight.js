import * as THREE from './assets/three.module.js';

const AU = 149597870.7;
const LIGHT_SPEED = 299792.458;
const bodies = [
  ['Sun', 'Star', 695700, 0, 0, 0, 'sun', '#ffbe67'],
  ['Mercury', 'Rocky planet', 2439.7, .3871, 252, .034, 'mercury', '#a8a098'],
  ['Venus', 'Rocky planet', 6051.8, .7233, 182, 177.4, 'venus_surface', '#d3af77'],
  ['Earth', 'Rocky planet', 6378.137, 1, 100, 23.44, 'earth_daymap', '#729dee'],
  ['Mars', 'Rocky planet', 3396.2, 1.5237, 355, 25.19, 'mars', '#bf7659'],
  ['Jupiter', 'Gas giant', 71492, 5.2029, 34, 3.13, 'jupiter', '#d1a486'],
  ['Saturn', 'Gas giant', 60268, 9.5367, 50, 26.73, 'saturn', '#e1c39c'],
  ['Uranus', 'Ice giant', 25559, 19.1892, 314, 97.77, 'uranus', '#93d6dd'],
  ['Neptune', 'Ice giant', 24764, 30.0699, 304, 28.32, 'neptune', '#6f95db'],
  ['Moon', 'Natural satellite', 1738.1, 0, 0, 6.68, 'moon', '#b6b6bc'],
].map(([name, type, radius, orbit, longitude, tilt, texture, color], index) => {
  const angle = THREE.MathUtils.degToRad(longitude);
  const position = new THREE.Vector3(Math.cos(angle) * orbit * AU, 0, Math.sin(angle) * orbit * AU);
  return {name, type, radius, position, tilt: THREE.MathUtils.degToRad(tilt), texture, color, index};
});
const moon = bodies.at(-1);
moon.position.copy(bodies[3].position).add(new THREE.Vector3(321245, 0, 211074).setLength(384400));

const el = id => document.getElementById(id);
const viewport = el('viewport');
const controls = el('controls');
const speedInput = el('speed');
const throttle = el('throttle');
const status = el('flight-status');
const directions = new Set();
let renderer;

try {
  renderer = new THREE.WebGLRenderer({antialias: true, logarithmicDepthBuffer: true});
} catch {
  status.textContent = 'WEBGL UNAVAILABLE';
  viewport.textContent = 'This simulator needs WebGL to display the solar system.';
  viewport.classList.add('unavailable');
}
el('help').addEventListener('click', () => controls.showModal());
el('fullscreen').hidden = !document.fullscreenEnabled;
el('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el('simulator').requestFullscreen();
  } catch {
    status.textContent = 'FULLSCREEN UNAVAILABLE';
  }
});


function startFlight() {
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 1e12);
  camera.rotation.order = 'YXZ';
  const scene = new THREE.Scene();
  const loader = new THREE.TextureLoader();
  const sphere = new THREE.SphereGeometry(1, 96, 64);
  const ship = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const motion = new THREE.Vector3();
  const cameraOffset = new THREE.Vector3();
  const pointingCamera = new THREE.PerspectiveCamera();
  pointingCamera.rotation.order = 'YXZ';
  const properUp = new THREE.Vector3(0, 1, 0);
  let target = bodies[6];
  let speed = 0;
  let warpTimer;
  let tracking = true;
  let pointer;

  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  viewport.append(renderer.domElement);
  scene.background = makeStarfield();

  for (const body of bodies) {
    body.sunward = body.position.clone().negate().normalize();
    body.group = new THREE.Group();
    body.group.rotation.z = body.tilt;
    const map = loader.load(new URL(`assets/${body.texture}.jpg`, import.meta.url).href);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const material = body.index === 0
      ? new THREE.MeshBasicMaterial({map})
      : litMaterial(map, body.sunward);
    const globe = new THREE.Mesh(sphere, material);
    globe.scale.y = ({5: .935, 6: .902, 7: .977, 8: .983})[body.index] ?? 1;
    body.group.add(globe);
    if (body.name === 'Saturn') body.group.add(makeRings(body.sunward, body.tilt));
    scene.add(body.group);

    const button = document.createElement('button');
    button.className = 'destination';
    const icon = document.createElement('span');
    icon.className = body.name === 'Saturn' ? 'planet-icon ring' : 'planet-icon';
    icon.style.setProperty('--orb', body.color);
    const label = document.createElement('small');
    label.textContent = body.index === 9 ? '03a' : String(body.index).padStart(2, '0');
    button.append(icon, body.name, label);
    button.addEventListener('click', () => select(body));
    el('destinations').append(button);
    body.button = button;
  }

  function resize() {
    const {clientWidth: width, clientHeight: height} = viewport;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (tracking) pointAtTarget(true);
  }
  new ResizeObserver(resize).observe(viewport);
  resize();

  function pointAtTarget(framed) {
    pointingCamera.position.set(0, 0, 0);
    const relative = target.position.clone().sub(ship);
    if (!relative.lengthSq()) return;
    pointingCamera.lookAt(relative);
    if (framed) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(pointingCamera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(pointingCamera.quaternion);
      relative.addScaledVector(right, -relative.length() * (camera.aspect > 1.1 ? .19 : 0));
      relative.addScaledVector(up, -relative.length() * .10);
      pointingCamera.lookAt(relative);
    }
    camera.quaternion.copy(pointingCamera.quaternion);
  }

  function select(body, frame = false) {
    target = body;
    for (const entry of bodies) entry.button.setAttribute('aria-pressed', String(entry === body));
    const code = body.index === 9 ? '03A' : String(body.index).padStart(2, '0');
    el('classification').textContent = `TARGET ${code} / ${body.type.toUpperCase()}`;
    el('target-name').textContent = body.name;
    el('diameter').textContent = `${format(body.radius * 2)} km`;
    tracking = frame;
    pointAtTarget(frame);
    updateReadouts();
  }

  function arrive(showStatus) {
    setSpeed(0);
    const sunward = target.index === 0 ? new THREE.Vector3(0, 0, 1) : target.sunward;
    const tangent = new THREE.Vector3().crossVectors(properUp, sunward).normalize();
    cameraOffset.copy(sunward).multiplyScalar(.79).addScaledVector(tangent, .63);
    cameraOffset.y = target.name === 'Saturn' ? -.14 : .35;
    const standOff = target.name === 'Saturn' ? 5.7 : 4.3;
    ship.copy(target.position).addScaledVector(cameraOffset.normalize(), target.radius * standOff);
    select(target, true);
    if (showStatus) {
      clearTimeout(warpTimer);
      status.textContent = `ARRIVED AT ${target.name.toUpperCase()}`;
      warpTimer = setTimeout(updateStatus, 1800);
    }
  }

  function updateStatus() {
    status.textContent = speed > LIGHT_SPEED ? 'SUPERLUMINAL CRUISE' : speed > 0 ? 'CRUISE ENGAGED' : 'SYSTEMS ONLINE';
  }

  function setSpeed(value, updateInput = true) {
    speed = value;
    if (updateInput || Number(speedInput.value) !== speed) speedInput.value = String(speed);
    speedInput.removeAttribute('aria-invalid');
    el('speed-error').textContent = '';
    throttle.value = value === 0 ? -2 : Math.max(-1.99, Math.log10(value));
    el('speed-ratio').textContent = value === 0 ? '0.0000 c' : `${format(value / LIGHT_SPEED, 4)} c`;
    updateStatus();
  }

  function adjustSpeed(increase) {
    const next = increase ? (speed ? speed * 1.6 : 1) : speed / 1.6;
    if (Number.isFinite(next)) setSpeed(next < .001 ? 0 : next);
  }

  function updateReadouts() {
    const distance = Math.hypot(target.position.x - ship.x, target.position.y - ship.y, target.position.z - ship.z);
    el('distance').textContent = distance < AU ? `${format(distance)} km` : `${format(distance / AU, 3)} AU`;
    const seconds = distance / LIGHT_SPEED;
    el('light-time').textContent = seconds < 60 ? `${format(seconds, 2)} s` : seconds < 3600
      ? `${format(seconds / 60, 2)} min` : `${format(seconds / 3600, 2)} h`;
  }

  speedInput.addEventListener('change', () => {
    const raw = speedInput.value.trim();
    const value = Number(raw);
    if (!/^\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(value) || value < 0) {
      speedInput.setAttribute('aria-invalid', 'true');
      el('speed-error').textContent = 'Enter a finite speed of 0 km/s or higher.';
      return;
    }
    setSpeed(value, false);
  });
  speedInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') speedInput.blur();
  });
  throttle.addEventListener('input', () => {
    const exponent = Number(throttle.value);
    setSpeed(exponent === -2 ? 0 : Number((10 ** exponent).toPrecision(5)));
  });
  el('brake').addEventListener('click', () => {
    directions.clear();
    setSpeed(0);
  });
  el('warp').addEventListener('click', () => {
    directions.clear();
    arrive(true);
  });

  const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'];
  window.addEventListener('keydown', event => {
    if (event.target.closest('input') || controls.open || event.ctrlKey || event.metaKey || event.altKey) return;
    if (movementKeys.includes(event.code)) {
      directions.add(event.code);
      event.preventDefault();
    } else if (event.code === 'Space' && !event.target.closest('button, a')) {
      el('brake').click();
      event.preventDefault();
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      adjustSpeed(event.key !== '-');
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', event => directions.delete(event.code));
  window.addEventListener('blur', () => directions.clear());
  el('help').addEventListener('click', () => directions.clear());

  viewport.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    pointer = {x: event.clientX, y: event.clientY, id: event.pointerId};
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', event => {
    if (pointer?.id !== event.pointerId) return;
    tracking = false;
    camera.rotation.y -= (event.clientX - pointer.x) * .003;
    camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - (event.clientY - pointer.y) * .003, -1.56, 1.56);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  });
  viewport.addEventListener('lostpointercapture', () => { pointer = undefined; });
  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    if (event.deltaY) adjustSpeed(event.deltaY < 0);
  }, {passive: false});

  arrive(false);
  target.button.scrollIntoView({block: 'nearest', inline: 'center'});
  let previousTime = performance.now();
  let nextReadout = 0;
  renderer.setAnimationLoop(time => {
    const dt = Math.min(.1, Math.max(0, (time - previousTime) / 1000));
    previousTime = time;
    if (speed || directions.size) {
      tracking = false;
      camera.getWorldDirection(forward);
      const distance = Math.hypot(ship.x - target.position.x, ship.y - target.position.y, ship.z - target.position.z);
      const maneuverSpeed = Math.max(1, Math.min(distance * .16, 1e7));
      motion.set(
        Number(directions.has('KeyD')) - Number(directions.has('KeyA')),
        Number(directions.has('KeyE')) - Number(directions.has('KeyQ')),
        Number(directions.has('KeyS')) - Number(directions.has('KeyW')),
      ).normalize().applyQuaternion(camera.quaternion).multiplyScalar(maneuverSpeed * dt);
      motion.addScaledVector(forward, speed * dt).add(ship);
      if (Number.isFinite(Math.hypot(motion.x, motion.y, motion.z))) ship.copy(motion);
      else setSpeed(0);
    }
    // Rebase the world around the ship. Uniform rescaling at extreme ranges
    // keeps translations finite on the GPU without altering apparent angles.
    const renderScale = Math.min(1, 1e10 / Math.max(Math.abs(ship.x), Math.abs(ship.y), Math.abs(ship.z), 1));
    for (const body of bodies) {
      body.group.position.copy(body.position).sub(ship).multiplyScalar(renderScale);
      body.group.scale.setScalar(body.radius * renderScale);
    }
    renderer.render(scene, camera);
    if (time >= nextReadout) {
      updateReadouts();
      nextReadout = time + 100;
    }
  });
}

function format(value, decimals = 0) {
  if (value >= 1e10 || (value > 0 && value < 10 ** -decimals && decimals > 0)) return value.toExponential(2);
  return value.toLocaleString('en-US', {maximumFractionDigits: decimals});
}

const vertexShader = `
  varying vec3 localPosition;
  varying vec3 viewNormal;
  varying vec2 surfaceUV;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    localPosition = position;
    viewNormal = normalize(normalMatrix * normal);
    surfaceUV = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

function litMaterial(map, sunward) {
  return new THREE.ShaderMaterial({
    uniforms: { surfaceMap: {value: map}, sunward: {value: sunward} },
    vertexShader,
    fragmentShader: `
      uniform sampler2D surfaceMap;
      uniform vec3 sunward;
      varying vec3 viewNormal;
      varying vec2 surfaceUV;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec3 light = normalize((viewMatrix * vec4(sunward, 0.0)).xyz);
        vec3 normal = normalize(viewNormal);
        float daylight = smoothstep(-0.12, 0.85, dot(normal, light));
        vec3 surface = texture2D(surfaceMap, surfaceUV).rgb;
        float haze = pow(1.0 - max(normal.z, 0.0), 4.0) * daylight;
        gl_FragColor = vec4(surface * (0.065 + 1.06 * daylight) + vec3(.12,.15,.2) * haze, 1.);
        #include <colorspace_fragment>
      }
    `,
  });
}

function makeRings(sunward, tilt) {
  const inner = 74658 / 60268;
  const outer = 140270 / 60268;
  const geometry = new THREE.RingGeometry(inner, outer, 256);
  geometry.rotateX(-Math.PI / 2);
  const localLight = sunward.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), -tilt);
  return new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    uniforms: { localLight: {value: localLight}, inner: {value: inner}, outer: {value: outer} },
    vertexShader,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    fragmentShader: `
      uniform vec3 localLight;
      uniform float inner;
      uniform float outer;
      varying vec3 localPosition;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      float wave(float radius, float frequency) {
        float antialias = 1.0 - smoothstep(.45, 2.5, fwidth(radius) * frequency);
        return sin(radius * frequency) * antialias;
      }
      void main() {
        #include <logdepthbuf_fragment>
        float radius = length(localPosition.xz);
        float r = (radius - inner) / (outer - inner);
        float ringB = smoothstep(.23,.29,r) * (1.0 - smoothstep(.671,.682,r));
        float ringA = smoothstep(.743,.753,r) * (1.0 - smoothstep(.969,.98,r));
        float ringC = smoothstep(.008,.029,r) * (1.0 - smoothstep(.27,.31,r));
        float ringF = exp(-pow((r-.998)*510.,2.));
        float bands = .84 + .08*wave(r,67.) + .06*wave(r,181.) + .07*wave(r,550.) + .04*wave(r,1300.);
        float alpha = (ringB*.87 + ringA*.69 + ringC*.32 + ringF*.42) * bands;
        float alignment = dot(localPosition, localLight);
        float impact = length(localPosition - alignment * localLight);
        float shadow = alignment < 0.0 ? smoothstep(.91,1.01,impact) : 1.0;
        vec3 color = mix(vec3(.42,.32,.25), vec3(.89,.76,.59), clamp(ringB*.85+ringA*.57 + bands*.17,0.,1.));
        gl_FragColor = vec4(color * (.13 + .87*shadow), alpha);
        #include <colorspace_fragment>
      }
    `,
  }));
}

function makeStarfield() {
  const canvas = document.createElement('canvas');
  canvas.width = 4096;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let seed = 47;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < 390; index++) {
    const x = random() * canvas.width;
    const y = 1100 + 240 * Math.sin(x / canvas.width * Math.PI * 2) + (random() - .5) * 460;
    const radius = 45 + 130 * random();
    const cloud = ctx.createRadialGradient(x, y, 0, x, y, radius);
    cloud.addColorStop(0, index % 3 ? '#607ba30a' : '#ad86681a');
    cloud.addColorStop(1, '#18243b00');
    ctx.fillStyle = cloud;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  for (let index = 0; index < 19000; index++) {
    const x = random() * canvas.width;
    const y = index % 3 ? random() * canvas.height
      : 1100 + 240 * Math.sin(x / canvas.width * Math.PI * 2) + (random() + random() + random() - 1.5) * 290;
    const brightness = random() ** 7;
    const radius = .36 + brightness * 1.55;
    ctx.fillStyle = `rgba(${index % 5 ? '201,222,255' : '255,215,173'},${.15 + brightness * .8})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (brightness > .96) {
      ctx.fillStyle = '#bbd9ff50';
      ctx.fillRect(x - 4, y - .3, 8, .6);
      ctx.fillRect(x - .3, y - 4, .6, 8);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

if (renderer) startFlight();
