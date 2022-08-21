"use strict";

const STRING_TITLE_PRE = "Escape from";
const STRING_TITLE = "Ganymede";
const STRING_START = "Press SPACE to start";
const STRING_GAME_OVER = "Game Over";
const STRING_RESTART = "Press SPACE to restart";

const TAU = Math.PI * 2;

/** Size of textures, in pixels */
const TEXTURE_SIZE = 8;

/** Width of camera, in pixels */
const CAMERA_WIDTH = 1024;

/** Height of camera, in pixels */
const CAMERA_HEIGHT = Math.floor(CAMERA_WIDTH / 2);

/** Plane length of camera */
const CAMERA_PLANE_LENGTH = 0.8;

/** Player move speed, in tiles per second */
const PLAYER_MOVE_SPEED = 6;

/** Player rotation speed, in radians per second */
const PLAYER_ROT_SPEED = Math.PI * 0.75;

/** Size of spatial lookup tiles, in map tiles */
const SPATIAL_TILE_SIZE = 2;

/** Key code which have their default behavior suppressed */
const SUPPRESS_KEYS = [13, 32, 37, 38, 39, 40, 65, 68, 83, 87];

/** Entity groups */
const GROUP_PLAYER = 1;
const GROUP_ENEMY = 2;
const GROUP_ENVIRONMENT = 3;

/** Collision groups (controls which groups collide with which other groups */
const COLLISION_GROUPS = new Map([
	[hash_ids(GROUP_PLAYER, GROUP_ENEMY), 1],
	[hash_ids(GROUP_ENEMY, GROUP_ENEMY), 1],
	[hash_ids(GROUP_PLAYER, GROUP_ENVIRONMENT), 1],
	[hash_ids(GROUP_ENEMY, GROUP_ENVIRONMENT), 1],
	[hash_ids(GROUP_ENVIRONMENT, GROUP_ENVIRONMENT), 1],
]);

const state_idle = {
	e: (id) => play_animation(id, 0),
};

const state_wander = {
	e: (id) => {
		// Randomly select a direction
		const bod = get_entity_component(id, "body");
		const angle = Math.random() * TAU;
		bod.vx = Math.cos(angle) * 1;
		bod.vy = Math.sin(angle) * 1;
		play_animation(id, 0);
	},
};

const state_chase = {
	e: (id) => {
		const target_pos = get_entity_component(player_id, "pos");
		const bod = get_entity_component(id, "body");
		if (target_pos === undefined) {
			bod.vx = 0;
			bod.vy = 0;
			return;
		}
		const pos = get_entity_component(id, "pos");
		const delta_x = target_pos.x - pos.x;
		const delta_y = target_pos.y - pos.y;
		pos.f = Math.atan2(delta_y, delta_x);
		bod.vx = Math.cos(pos.f) * 1.5;
		bod.vy = Math.sin(pos.f) * 1.5;
		play_animation(id, 0);
	},
};

const state_attack_windup = {
	e: (id) => {
		const body = get_entity_component(id, "body");
		body.vx = 0;
		body.vy = 0;
		play_animation(id, 1);
	},
};

const state_attack = {
	e: (id) => {
		const pos = get_entity_component(id, "pos");
		const x = pos.x + Math.cos(pos.f) * 1;
		const y = pos.y + Math.sin(pos.f) * 1;
		spawn_prefab_entity("dmg_enemy", x, y, pos.f);
		play_animation(id, 2);
	},
};

function entity_distance(a, b) {
	const pos_a = get_entity_component(a, "pos");
	const pos_b = get_entity_component(b, "pos");
	if (pos_a === undefined || pos_b === undefined) {
		return Infinity;
	} else {
		return distance(pos_a.x, pos_a.y, pos_b.x, pos_b.y);
	}
}

function player_distance(id) {
	return entity_distance(player_id, id);
}

const BEHAVIORS = {
	dummy: {
		i: state_wander,
	},
	slime: {
		i: state_wander,
		t: [
			{
				// Wander -> Wander on interval
				f: state_wander,
				d: 3,
				t: state_wander,
			},
			{
				// Wander -> Chase when player is near
				f: state_wander,
				c: (id) => player_distance(id) < 5,
				t: state_chase,
			},
			{
				// Chase -> Chase on interval
				f: state_chase,
				d: 0.2,
				t: state_chase,
			},
			{
				// Chase -> Wander when player is far
				f: state_chase,
				c: (id) => player_distance(id) > 9,
				t: state_wander,
			},
			{
				// Chase -> Attack windup when player is very close
				f: state_chase,
				c: (id) => player_distance(id) < 1,
				t: state_attack_windup,
			},
			{
				// Attack windup -> Attack
				f: state_attack_windup,
				d: 0.5,
				t: state_attack,
			},
			{
				f: state_attack,
				d: 0.5,
				t: state_idle,
			},
			{
				f: state_idle,
				d: 0.5,
				t: state_chase,
			},
		],
	},
};

/*
COMPONENTS:

pos (Position)
	x: X coordinate (units)
	y: Y coordinate (units)

body (Physics body)
	w: 	Width (units)
	h: 	Height (units)
	vx: Velocity X (units/s)
	vy: Velocity Y (units/s)
	b: 	Bounce (0 - 1)
	g: 	Collision group
	t:  Trigger (0 = no, 1 = yes)
	c:  Contacting entity IDs

ttl (Time-to-live)
	d: Duration (seconds)

mor (Mortal)
	h: Hit points

haz (Hazard)
	d: Damage
	o: One shot (0 = no, 1 = yes)

pla (Player)
	w: Weapon
	c: Weapon cooldown

sprite (Sprite)
	i: Sprite sheet index

ani (Animation)
	f: Array of frame indices, e.g. [[1, 2], [3, 4, 5]] (two animations)
	a: Current animation index
	i: Current frame index
	d: Frame delay (seconds)
	e: Frame elapsed (seconds)

beh (Behavior)
	m: string; Behavior model
	s: object; Behavior state
	e: number; Elapsed time in current state

*/

/** Prefabricated entities */
const PREFABS = {
	player: {
		pos: { x: 0, y: 0, f: 0 },
		body: { w: 0.4, h: 0.4, vx: 0, vy: 0, b: 0, g: GROUP_PLAYER, c: [] },
		pla: { w: "pistol", c: 0 },
		mor: { h: 3 },
	},
	dummy: {
		pos: { x: 0, y: 0, f: 0 },
		body: { w: 0.5, h: 0.5, vx: 0, vy: 0, b: 1, g: GROUP_ENEMY, c: [] },
		mor: { h: 3 },
		sprite: { i: 1 },
		sig: { n: 3, f: 7 },
		tar: {},
		beh: { m: "dummy" },
	},
	slime: {
		pos: { x: 0, y: 0, f: 0 },
		body: { w: 0.8, h: 0.8, vx: 0, vy: 0, b: 1, g: GROUP_ENEMY, c: [] },
		mor: { h: 6 },
		sprite: { i: 6 },
		ani: { f: [[6, 7], [10], [7]], i: 0, d: 0.25, e: 0, a: 0 },
		beh: { m: "slime" },
	},
	slime2: {
		pos: { x: 0, y: 0, f: 0 },
		body: { w: 0.8, h: 0.8, vx: 0, vy: 0, b: 1, g: GROUP_ENEMY, c: [] },
		mor: { h: 6 },
		sprite: { i: 6 },
		ani: { f: [[11, 12], [13], [12]], i: 0, d: 0.25, e: 0, a: 0 },
		beh: { m: "slime" },
	},
	bullet: {
		pos: { x: 0, y: 0, f: 0 },
		body: {
			w: 0.25,
			h: 0.25,
			vx: 0,
			vy: 0,
			b: 0,
			t: 1,
			g: GROUP_PLAYER,
			c: [],
		},
		haz: { d: 1, o: 1 },
		sprite: { i: 2 },
	},
	boom: {
		pos: { x: 0, y: 0, f: 0 },
		sprite: { i: 3 },
		ani: { f: [[3, 4, 5]], i: 0, d: 0.1, e: 0, a: 0 },
		ttl: { d: 0.3 },
	},
	rift: {
		pos: { x: 0, y: 0, f: 0 },
		sprite: { i: 8 },
		ani: { f: [[8, 9]], i: 0, d: 0.25, e: 0, a: 0 },
	},
	tnt: {
		pos: { x: 0, y: 0, f: 0 },
		body: {
			w: 0.5,
			h: 0.5,
			vx: 0,
			vy: 0,
			b: 0,
			g: GROUP_ENVIRONMENT,
			c: [],
		},
		mor: { h: 2 },
		sprite: { i: 1 },
	},
	dmg_enemy: {
		pos: { x: 0, y: 0, f: 0 },
		body: {
			w: 1,
			h: 1,
			vx: 0,
			vy: 0,
			b: 0,
			t: 1,
			g: GROUP_ENEMY,
			c: [],
		},
		haz: { d: 1, o: 1 },
		ttl: { d: 0.25 },
	},
};

/**
 * Weapon definitions
 * p = Prefab to spawn
 * d = Distance from spawner
 * s = Projectile speed
 * c = Spawner cooldown, in seconds
 */
const WEAPONS = {
	pistol: {
		p: "bullet",
		d: 0.5,
		s: 12,
		c: 0.4,
	},
};

const MAP_GENERATORS = [
	(x, y) => x % 4 === 0 && y % 4 === 0,
	(x, y, _w, _h, cx, cy) => {
		const d = distance(x, y, cx, cy);
		return ((d > 4 && d < 7) || d > 11) && x !== cx && y !== cy;
	},
	(x, y, w, h, cx) => {
		return (
			((x > 3 && x < cx - 2) || (x > cx + 2 && x < w - 4)) && y > 2 && y < h - 3
		);
	},
];

/** Game state controls the high-level game phases */
let game_state = "load";

/** Game timer holds the number of milliseconds until a state change */
let game_timer = 0;

/** Keyboard state */
const keyboard = {};

/** Time of the last frame */
let last_frame = 0;

/** Canvas 2D drawing surface */
let canvas;
let ctx;
let bg_buffer;

/** Depth buffer */
let depth_buffer;

/** Textures */
const textures = new Image();

/** Simulation map */
let map_width = 0;
let map_height = 0;
let map_tiles;

/** Camera */
let camera_x = 0;
let camera_y = 0;
let camera_facing_x = 1;
let camera_facing_y = 0;
let camera_plane_x = 0;
let camera_plane_y = CAMERA_PLANE_LENGTH;

/** UI elements */
const ui = [];

const overlay = add_ui({
	e: 0,
	x: 0,
	y: 0,
	w: CAMERA_WIDTH,
	h: CAMERA_HEIGHT,
	c: "#000",
	a: 1,
});

const text_pre = add_ui({
	e: 1,
	t: "",
	s: 64,
	c: "#c8c8c8",
	x: CAMERA_WIDTH / 2,
	y: CAMERA_HEIGHT * 0.25,
	a: 0,
});

const text_main = add_ui({
	e: 1,
	t: "",
	s: 128,
	c: "#27badb",
	x: CAMERA_WIDTH / 2,
	y: CAMERA_HEIGHT / 2,
	a: 0,
});

const text_cta = add_ui({
	e: 1,
	t: "",
	s: 32,
	c: "#fff",
	x: CAMERA_WIDTH / 2,
	y: CAMERA_HEIGHT * 0.75,
	a: 0,
});

/** Player entity */
let player_id = 0;

/** Simulation components */
const components = {};

/** Next entity ID */
let next_entity_id = 1;

/** Active tweens */
const tweens = [];

/** Simulation systems which operate on entities */
const systems = [];

/** Simulation spatial map for broad phase collision detection */
let spatial_width = 0;
let spatial_height = 0;
const spatial_tiles = [];

/** Temp rects for collision checking */
const tile_bb = { x: 0, y: 0, w: 1, h: 1 };
const temp_rect = { x: 0, y: 0, w: 0, h: 0 };

/** Convert an X,Y coordinate into a grid index, given a grid width */
function idx(x, y, w) {
	return y * w + x;
}

/** A random integer between 0 and max (exclusive) */
function random_int(max) {
	return Math.floor(Math.random() * max);
}

/** Return a random thing from a group of things */
function random_pick(things) {
	const index = random_int(things.length);
	return things[index];
}

/** Return the distance between two points */
function distance(x1, y1, x2, y2) {
	return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/** Clamp a number between two values */
function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max);
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function map_number(x, in_min, in_max, out_min, out_max) {
	return ((x - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;
}

function add_ui(element) {
	ui.push(element);
	return element;
}

/** Initialize the map to a new size */
function init_map(width, height) {
	map_width = width;
	map_height = height;
	map_tiles = new Uint8Array(map_width * map_height);
	spatial_width = Math.ceil(width / SPATIAL_TILE_SIZE);
	spatial_height = Math.ceil(height / SPATIAL_TILE_SIZE);
	spatial_tiles.length = 0;
	for (let i = 0; i < spatial_width * spatial_height; i++) {
		spatial_tiles.push([]);
	}
}

function generate_map(width, height) {
	init_map(width, height);
	const generator = random_pick(MAP_GENERATORS);
	const cx = Math.floor(width / 2);
	const cy = Math.floor(height / 2);
	for (let i = 0; i < map_tiles.length; i++) {
		const x = i % map_width;
		const y = Math.floor(i / map_width);
		map_tiles[i] = generator(x, y, width, height, cx, cy) ? 1 : 0;
	}
}

function spawn_hazards() {
	const cx = Math.floor(map_width / 2);
	const cy = Math.floor(map_height / 2);
	for (let i = 0; i < map_tiles.length; i++) {
		const x = i % map_width;
		const y = Math.floor(i / map_width);
		if (
			map_tiles[i] === 0 &&
			distance(x, y, cx, cy) > 4 &&
			Math.random() < 0.05
		) {
			const prefab = random_pick([/*"dummy",*/ "slime2", "slime"]);
			spawn_prefab_entity(prefab, x + 0.5, y + 0.5, 0);
		}
	}
}

/** Set the camera position and facing */
function set_camera(x, y, facing_x, facing_y) {
	camera_x = x;
	camera_y = y;
	camera_facing_x = facing_x;
	camera_facing_y = facing_y;
	camera_plane_x = -facing_y * CAMERA_PLANE_LENGTH;
	camera_plane_y = facing_x * CAMERA_PLANE_LENGTH;
}

/** Handle a keyboard event */
function handle_key(e, state) {
	keyboard[e.keyCode] = !!state;
	if (SUPPRESS_KEYS.indexOf(e.keyCode) !== -1) {
		e.preventDefault();
	}
}

/** Check whether any given keys are down */
function key_down(...keys) {
	for (const key of keys) {
		if (keyboard[key]) {
			return true;
		}
	}
	return false;
}

function play_animation(id, index) {
	const anim = get_entity_component(id, "ani");
	if (anim.a !== index) {
		anim.a = index;
		anim.i = anim.f[anim.a][0];
		anim.e = 0;
	}
}

/** Clear the spatial lookup map */
function clear_spatial_map() {
	for (const bucket of spatial_tiles) {
		bucket.length = 0;
	}
}

/** Insert a bounds into the spatial lookup map */
function insert_spatial_bounds(id, bb) {
	const ox = Math.floor(bb.x / SPATIAL_TILE_SIZE);
	const oy = Math.floor(bb.y / SPATIAL_TILE_SIZE);
	const tx = Math.floor((bb.x + bb.w) / SPATIAL_TILE_SIZE);
	const ty = Math.floor((bb.y + bb.h) / SPATIAL_TILE_SIZE);
	for (let y = oy; y <= ty; y++) {
		for (let x = ox; x <= tx; x++) {
			const index = idx(x, y, spatial_width);
			if (index < spatial_tiles.length) {
				spatial_tiles[index].push(id);
			}
		}
	}
}

/** Get nearby bounds within the spatial lookup map */
function get_spatial_neighbors(bb) {
	const neighbors = [];
	const ox = Math.floor(bb.x / SPATIAL_TILE_SIZE);
	const oy = Math.floor(bb.y / SPATIAL_TILE_SIZE);
	const tx = Math.floor((bb.x + bb.w) / SPATIAL_TILE_SIZE);
	const ty = Math.floor((bb.y + bb.h) / SPATIAL_TILE_SIZE);
	for (let y = oy; y <= ty; y++) {
		for (let x = ox; x <= tx; x++) {
			const index = idx(x, y, spatial_width);
			if (index < spatial_tiles.length) {
				neighbors.push(...spatial_tiles[index]);
			}
		}
	}
	return neighbors;
}

/** Spawn an entity from a prefab definition */
function spawn_prefab_entity(prefabKey, x, y, facing) {
	const id = next_entity_id++;
	const prefabComponents = PREFABS[prefabKey];
	for (const componentKey in prefabComponents) {
		const data = Object.assign({}, prefabComponents[componentKey]);
		add_entity_component(id, componentKey, data);
	}
	const pos = get_entity_component(id, "pos");
	if (pos !== undefined) {
		pos.x = x || pos.x;
		pos.y = y || pos.y;
		pos.f = facing || pos.f;
	}
	return id;
}

/** Add a component for a given entity */
function add_entity_component(id, key, data) {
	let group = components[key];
	if (group === undefined) {
		group = new Map();
		components[key] = group;
	}
	group.set(id, data);
}

/** Get a component for a given entity */
function get_entity_component(id, key) {
	const group = components[key];
	if (group !== undefined) {
		return group.get(id);
	}
}

/** Remove an entity from the world */
function remove_entity(id) {
	for (const key in components) {
		components[key].delete(id);
	}
}

function clear_entities() {
	for (const key in components) {
		delete components[key];
	}
}

/** Tween a property on a target to a specified value */
function tween(subject, prop, to, duration) {
	tweens.push({
		s: subject,
		p: prop,
		f: subject[prop],
		t: to,
		d: duration,
		e: 0,
	});
}

/** Return the sign of a given number */
function sign(n) {
	return n > 0 ? 1 : n === 0 ? 0 : -1;
}

/** Hash two IDs into a unique number (order independent) */
function hash_ids(a, b) {
	return a < b ? idx(a, b, 100) : idx(b, a, 100);
}

/** Update a body's bounding box based on its position */
function update_bounding_box(pos, body) {
	if (body.bb === undefined) {
		body.bb = { x: 0, y: 0, w: 0, h: 0 };
	}
	body.bb.x = pos.x - body.w / 2;
	body.bb.y = pos.y - body.h / 2;
	body.bb.w = body.w;
	body.bb.h = body.h;
}

/** Determine if two rectangles overlap */
function rect_overlap(a, b) {
	return (
		a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
	);
}

/** Calculate the intersection rectangle of overlapping rectangles */
function rect_intersection(a, b, out) {
	if (out === undefined) {
		out = {};
	}
	const x1 = Math.min(a.x + a.w, b.x + b.w);
	const x2 = Math.max(a.x, b.x);
	const y1 = Math.min(a.y + a.h, b.y + b.h);
	const y2 = Math.max(a.y, b.y);
	out.x = Math.min(x1, x2);
	out.y = Math.min(y1, y2);
	out.w = Math.max(0, x1 - x2);
	out.h = Math.max(0, y1 - y2);
	return out;
}

/** Cast a ray within the map, and return resulting hit info */
function raycast(ox, oy, dx, dy) {
	const result = { d: 0, s: 0 };

	// Cell coordinates begin at the cell containing the ray's origin
	let x = Math.floor(ox);
	let y = Math.floor(oy);

	const delta_dist_x = Math.sqrt(1 + (dy * dy) / (dx * dx));
	const delta_dist_y = Math.sqrt(1 + (dx * dx) / (dy * dy));

	let side_dist_x = 0;
	let side_dist_y = 0;
	let step_x = 0;
	let step_y = 0;
	let hit = false;

	// Calculate step and side distance
	if (dx < 0) {
		step_x = -1;
		side_dist_x = (ox - x) * delta_dist_x;
	} else {
		step_x = 1;
		side_dist_x = (x + 1.0 - ox) * delta_dist_x;
	}
	if (dy < 0) {
		step_y = -1;
		side_dist_y = (oy - y) * delta_dist_y;
	} else {
		step_y = 1;
		side_dist_y = (y + 1.0 - oy) * delta_dist_y;
	}

	// Perform DDA
	while (!hit) {
		// Jump to next map square
		if (side_dist_x < side_dist_y) {
			side_dist_x += delta_dist_x;
			x += step_x;
			result.s = 0;
		} else {
			side_dist_y += delta_dist_y;
			y += step_y;
			result.s = 1;
		}

		if (x >= 0 && x < map_width && y >= 0 && y < map_height) {
			const i = y * map_width + x;
			const value = map_tiles[i];
			if (value !== 0) {
				// Hit a wall
				result.v = value;
				hit = true;
			}
		} else {
			// We hit an invalid cell
			result.v = 1;
			break;
		}
	}

	// Calculate distance projected on camera direction (oblique distance will give fisheye effect!)
	if (result.s === 0) {
		result.d = (x - ox + (1 - step_x) / 2) / dx;
	} else {
		result.d = (y - oy + (1 - step_y) / 2) / dy;
	}

	return result;
}

function render_rect(x, y, width, height, color) {
	ctx.fillStyle = color;
	ctx.fillRect(x, y, width, height);
}

function render_text(text, size, color, x, y) {
	const shadow_offset = Math.min(Math.floor(size / 16), 4);
	ctx.font = `${size}px Menlo, monospace`;
	const metrics = ctx.measureText(text);
	ctx.fillStyle = "#202040";
	ctx.fillText(
		text.toUpperCase(),
		x - metrics.width / 2 + shadow_offset,
		y + shadow_offset
	);
	ctx.fillStyle = color;
	ctx.fillText(text.toUpperCase(), x - metrics.width / 2, y);
}

// #############################################################################
// ### SYSTEMS #################################################################
// #############################################################################

/** User input system */
function system_input(dt) {
	if (game_state !== "play") {
		return;
	}

	const pla = get_entity_component(player_id, "pla");
	if (pla === undefined) {
		return;
	}
	const pos = get_entity_component(player_id, "pos");
	// Decrease player attack cooldown
	if (pla.c > 0) {
		pla.c -= dt;
	}
	const facing_x = Math.cos(pos.f);
	const facing_y = Math.sin(pos.f);
	const move_distance = PLAYER_MOVE_SPEED * dt;
	const rot_distance = PLAYER_ROT_SPEED * dt;
	if (key_down(38, 87)) {
		pos.x += facing_x * move_distance;
		pos.y += facing_y * move_distance;
	} else if (key_down(40, 83)) {
		pos.x -= facing_x * move_distance;
		pos.y -= facing_y * move_distance;
	}
	if (key_down(37, 65)) {
		pos.f -= rot_distance;
	} else if (key_down(39, 68)) {
		pos.f += rot_distance;
	}
	if (key_down(13, 32) && pla.c <= 0) {
		const weapon = WEAPONS[pla.w];
		// Set player attack cooldown
		pla.c += weapon.c;
		// Spawn a projectile
		const hx = Math.cos(pos.f);
		const hy = Math.sin(pos.f);
		const px = pos.x + hx * weapon.d;
		const py = pos.y + hy * weapon.d;
		const id = spawn_prefab_entity(weapon.p, px, py, pos.f);
		const body = get_entity_component(id, "body");
		body.vx = hx * weapon.s;
		body.vy = hy * weapon.s;
	}
}

/** Physics system */
function system_physics(dt) {
	const bodies = components.body;
	if (bodies === undefined) {
		return;
	}

	clear_spatial_map();

	for (const [id, body] of bodies) {
		// Reset environment collision flag and contact list
		body.e = 0;
		body.c.length = 0;

		// Update body's position
		const pos = get_entity_component(id, "pos");
		pos.x += body.vx * dt;
		pos.y += body.vy * dt;

		update_bounding_box(pos, body);

		// Constrain physical bodies to the map
		if (body.bb.x < 0) {
			body.bb.x = 0;
			body.vx *= -body.b;
			body.e = 1;
		} else if (body.bb.x + body.bb.w >= map_width) {
			body.bb.x = map_width - body.bb.w;
			body.vx *= -body.b;
			body.e = 1;
		}
		if (body.bb.y < 0) {
			body.bb.y = 0;
			body.vy *= -body.b;
			body.e = 1;
		} else if (body.bb.y + body.bb.h >= map_height) {
			body.bb.y = map_height - body.bb.h;
			body.vy *= -body.b;
			body.e = 1;
		}

		// Detect tile map collisions
		const ox = Math.floor(body.bb.x);
		const oy = Math.floor(body.bb.y);
		const tx = Math.floor(body.bb.x + body.bb.w);
		const ty = Math.floor(body.bb.y + body.bb.h);
		const tiles = [];
		for (let y = oy; y <= ty; y++) {
			for (let x = ox; x <= tx; x++) {
				const index = idx(x, y, map_width);
				if (map_tiles[index] > 0) {
					body.e = 1;
					tile_bb.x = x;
					tile_bb.y = y;
					rect_intersection(body.bb, tile_bb, temp_rect);
					tiles.push({
						x: tile_bb.x,
						y: tile_bb.y,
						a: temp_rect.w * temp_rect.h,
					});
				}
			}
		}

		// Resolve tile map collisions
		if (tiles.length > 0) {
			// Sort tiles by largest intersection area
			if (tiles.length > 1) {
				tiles.sort((a, b) => b.a - a.a);
			}
			// Iterate over tiles and adjust body bounding box
			for (const tile of tiles) {
				tile_bb.x = tile.x;
				tile_bb.y = tile.y;
				rect_intersection(body.bb, tile_bb, temp_rect);
				if (temp_rect.w * temp_rect.h > 0) {
					if (temp_rect.w < temp_rect.h) {
						const sx = sign(
							body.bb.x + body.bb.w / 2 - (temp_rect.x + temp_rect.w / 2)
						);
						body.bb.x += temp_rect.w * sx;
						body.vx *= -body.b;
					} else {
						const sy = sign(
							body.bb.y + body.bb.h / 2 - (temp_rect.y + temp_rect.h / 2)
						);
						body.bb.y += temp_rect.h * sy;
						body.vy *= -body.b;
					}
				}
			}
		}

		// Sync position to bounding box
		pos.x = body.bb.x + body.w / 2;
		pos.y = body.bb.y + body.h / 2;

		insert_spatial_bounds(id, body.bb);
	}

	// Find colliding pairs
	const pairs = [];
	const checked = [];
	for (const [id, body] of bodies) {
		const neighbors = get_spatial_neighbors(body.bb);
		for (const neighbor_id of neighbors) {
			if (neighbor_id === id) {
				continue;
			}
			const hash = hash_ids(id, neighbor_id);
			if (checked.indexOf(hash) !== -1) {
				continue;
			}
			checked.push(hash);
			const neighbor_body = get_entity_component(neighbor_id, "body");
			const group_id = hash_ids(body.g, neighbor_body.g);
			if (
				COLLISION_GROUPS.has(group_id) &&
				rect_overlap(body.bb, neighbor_body.bb)
			) {
				body.c.push(neighbor_id);
				neighbor_body.c.push(id);
				if (body.t !== 1 && neighbor_body.t !== 1) {
					pairs.push([id, neighbor_id]);
				}
			}
		}
	}

	// Resolve colliding pairs
	for (const [a, b] of pairs) {
		// TODO: Allow for static vs dynamic collisions
		const body_a = get_entity_component(a, "body");
		const body_b = get_entity_component(b, "body");
		const pos_a = get_entity_component(a, "pos");
		const pos_b = get_entity_component(b, "pos");
		rect_intersection(body_a.bb, body_b.bb, temp_rect);
		if (temp_rect.w < temp_rect.h) {
			// Separate along the X axis
			const hw = temp_rect.w / 2;
			const ix = temp_rect.x + hw;
			pos_a.x += hw * sign(pos_a.x - ix);
			pos_b.x += hw * sign(pos_b.x - ix);
			body_a.vx *= -body_a.b;
			body_b.vx *= -body_b.b;
		} else {
			// Separate along the Y axis
			const hh = temp_rect.h / 2;
			const iy = temp_rect.y + hh;
			pos_a.y += hh * sign(pos_a.y - iy);
			pos_b.y += hh * sign(pos_b.y - iy);
			body_a.vy *= -body_a.b;
			body_b.vy *= -body_b.b;
		}
		update_bounding_box(pos_a, body_a);
		update_bounding_box(pos_b, body_b);
	}
}

/** Hazard management system */
function system_hazard() {
	const hazards = components.haz;
	if (hazards === undefined) {
		return;
	}

	for (const [id, hazard] of hazards) {
		const body = get_entity_component(id, "body");
		if (body.c.length > 0) {
			const contact_id = body.c[0];
			const mortal = get_entity_component(contact_id, "mor");
			if (mortal !== undefined) {
				mortal.h -= hazard.d;
			}
		}

		// Remove hazard if it's a "one shot"
		if (hazard.o === 1 && (body.e === 1 || body.c.length > 0)) {
			remove_entity(id);
		}
	}
}

/** Mortality system */
function system_mortal() {
	const mortals = components.mor;
	if (mortals === undefined) {
		return;
	}

	for (const [id, mortal] of mortals) {
		if (mortal.h <= 0) {
			const pos = get_entity_component(id, "pos");
			spawn_prefab_entity("boom", pos.x, pos.y, 0);
			remove_entity(id);
		}
	}
}

function system_game(dt) {
	if (game_timer > 0) {
		game_timer -= dt;
	}
	switch (game_state) {
		case "load":
			if (game_timer <= 0) {
				game_state = "load_outro";
				game_timer += 1;
				tween(overlay, "a", 0, 1);
			}
			break;
		case "load_outro":
			if (game_timer <= 0) {
				game_state = "title_intro";
				game_timer += 0.5;
				text_pre.t = STRING_TITLE_PRE;
				text_main.t = STRING_TITLE;
				text_main.c = "#27badb";
				text_cta.t = STRING_START;
				tween(text_pre, "a", 1, 0.5);
				tween(text_main, "a", 1, 0.5);
				tween(text_cta, "a", 1, 0.5);
			}
			break;
		case "title_intro":
			if (game_timer <= 0) {
				game_state = "title";
			}
			break;
		case "title":
			if (key_down(32)) {
				game_state = "title_outro";
				game_timer += 0.5;
				tween(text_pre, "a", 0, 0.25);
				tween(text_main, "a", 0, 0.25);
				tween(text_cta, "a", 0, 0.25);
			}
			break;
		case "title_outro":
			if (game_timer <= 0) {
				game_state = "play";
				player_id = spawn_prefab_entity(
					"player",
					camera_x,
					camera_y,
					Math.atan2(camera_facing_y, camera_facing_x)
				);
				spawn_hazards();
			}
			break;
		case "play":
			const pos = get_entity_component(player_id, "pos");
			if (pos === undefined) {
				game_state = "play_outro";
				game_timer += 2;
				overlay.c = "#4c0000";
				overlay.a = 0;
				tween(overlay, "a", 1, 1.5);
			}
			break;
		case "play_outro":
			if (game_timer <= 0) {
				clear_entities();
				game_state = "lost_intro";
				game_timer += 1;
				text_main.t = STRING_GAME_OVER;
				text_main.c = "#ffffff";
				text_cta.t = STRING_RESTART;
				tween(text_main, "a", 1, 1);
				tween(text_cta, "a", 1, 1);
			}
			break;
		case "lost_intro":
			if (game_timer <= 0) {
				game_state = "lost";
			}
			break;
		case "lost":
			if (key_down(32)) {
				game_state = "lost_outro";
				game_timer += 0.5;
				tween(text_main, "a", 0, 0.25);
				tween(text_cta, "a", 0, 0.25);
			}
			break;
		case "lost_outro":
			if (game_timer <= 0) {
				game_state = "load";
				game_timer = 0.5;
				overlay.a = 1;
				overlay.c = "#000";
				generate_map(21, 21);
				set_camera(
					Math.floor(map_width / 2) + 0.5,
					Math.floor(map_height / 2) + 0.5,
					1,
					0
				);
			}
			break;
	}
}

/** Camera management system */
function system_camera(dt) {
	switch (game_state) {
		case "load":
		case "load_outro":
		case "title_intro":
		case "title":
			let angle = Math.atan2(camera_facing_y, camera_facing_x);
			angle += TAU * 0.00625 * dt;
			set_camera(camera_x, camera_y, Math.cos(angle), Math.sin(angle));
			break;
		case "play":
			const pos = get_entity_component(player_id, "pos");
			if (pos !== undefined) {
				set_camera(pos.x, pos.y, Math.cos(pos.f), Math.sin(pos.f));
			}
			break;
	}
}

/** Tweening system */
function system_tween(dt) {
	const deadpool = [];

	// Update tweens
	for (let i = 0; i < tweens.length; i++) {
		const tw = tweens[i];
		tw.e += dt;
		const t = clamp(tw.e / tw.d, 0, 1);
		tw.s[tw.p] = lerp(tw.f, tw.t, t);
		if (tw.e >= tw.d) {
			deadpool.push(i);
		}
	}

	// Remove dead tweens
	for (let i = deadpool.length - 1; i >= 0; i--) {
		const index = deadpool[i];
		tweens.splice(index, 1);
	}
}

/** Animation system */
function system_animation(dt) {
	const anims = components.ani;
	if (anims === undefined) {
		return;
	}

	for (const [id, anim] of anims) {
		if (anim.a === undefined) {
			continue;
		}
		anim.e += dt;
		const frames = anim.f[anim.a];
		if (anim.e >= anim.d) {
			anim.e -= anim.d;
			if (++anim.i >= frames.length) {
				anim.i = 0;
			}
			const sprite = get_entity_component(id, "sprite");
			sprite.i = frames[anim.i];
		}
	}
}

/** Time-to-live system */
function system_ttl(dt) {
	const doomed = components.ttl;
	if (doomed === undefined) {
		return;
	}
	for (const [id, doom] of doomed) {
		doom.d -= dt;
		if (doom.d <= 0) {
			remove_entity(id);
		}
	}
}

/** Behavior system */
function system_behavior(dt) {
	const behaviors = components.beh;
	if (behaviors === undefined) {
		return;
	}

	// Update behaviors
	for (const [id, behavior] of behaviors) {
		const model = BEHAVIORS[behavior.m];
		if (behavior.s === undefined) {
			// Set initial state
			behavior.s = model.i;
			behavior.e = 0;

			// Trigger state enter
			if (behavior.s.e !== undefined) {
				behavior.s.e(id);
			}
		}

		// Increment elapsed time within this state
		behavior.e += dt;

		// Evaluate state transitions
		if (model.t !== undefined) {
			for (const transition of model.t) {
				// Only evaluate transitions from the current state
				if (transition.f !== behavior.s) {
					continue;
				}

				// Evaluate transition conditions
				if (
					(transition.d !== undefined && behavior.e >= transition.d) ||
					(transition.c !== undefined && transition.c(id))
				) {
					// Trigger state exit
					if (behavior.s.x !== undefined) {
						behavior.s.x(id);
					}

					// Set new state
					behavior.s = transition.t;
					behavior.e = 0;

					// Trigger state enter
					if (behavior.s.e !== undefined) {
						behavior.s.e(id);
					}
					break;
				}
			}
		}

		// Trigger state update
		if (behavior.s.u !== undefined) {
			behavior.s.u(id, dt);
		}
	}
}

/** Render the map/world to the canvas */
function system_render_map() {
	const half_height = CAMERA_HEIGHT / 2;

	const facing = Math.atan2(camera_facing_y, camera_facing_x);
	const angle = ((facing % TAU) + TAU) % TAU;
	const offset = Math.floor(map_number(angle, 0, TAU, 0, 1) * bg_buffer.width);

	if (offset === 0) {
		ctx.drawImage(bg_buffer, 0, 0);
	} else {
		// Left half
		ctx.drawImage(
			bg_buffer,
			offset,
			0,
			bg_buffer.width - offset,
			bg_buffer.height,
			0,
			0,
			bg_buffer.width - offset,
			bg_buffer.height
		);
		// Right half
		ctx.drawImage(
			bg_buffer,
			0,
			0,
			offset,
			bg_buffer.height,
			bg_buffer.width - offset,
			0,
			offset,
			bg_buffer.height
		);
	}

	for (let x = 0; x < CAMERA_WIDTH; x++) {
		const cam_x = (2 * x) / CAMERA_WIDTH - 1; // x coordinate in camera space

		const ray_x = camera_facing_x + camera_plane_x * cam_x;
		const ray_y = camera_facing_y + camera_plane_y * cam_x;

		const ray = raycast(camera_x, camera_y, ray_x, ray_y);

		const line_height = CAMERA_HEIGHT / ray.d;

		const draw_start = -line_height / 2 + half_height;
		const draw_end = line_height / 2 + half_height;

		let wall_x = 0;
		if (ray.s === 0) {
			wall_x = camera_y + ray.d * ray_y;
		} else {
			wall_x = camera_x + ray.d * ray_x;
		}
		wall_x -= Math.floor(wall_x);

		if (ray.v > 0) {
			// x coordinate on the texture
			let texture_x = Math.floor(wall_x * TEXTURE_SIZE);
			// flip texture x coordinate
			if ((ray.s === 0 && ray_x < 0) || (ray.s === 1 && ray_y > 0)) {
				texture_x = TEXTURE_SIZE - texture_x - 1;
			}

			// offset texture coordinate within texture
			texture_x += (ray.v - 1) * TEXTURE_SIZE;

			ctx.drawImage(
				textures,
				texture_x,
				0,
				1,
				TEXTURE_SIZE,
				x,
				draw_start,
				1,
				draw_end - draw_start
			);

			// Shading
			if (ray.s === 1) {
				ctx.fillStyle = "#202040";
				ctx.globalAlpha = 0.5;
				ctx.fillRect(x, draw_start, 1, draw_end - draw_start);
				ctx.globalAlpha = 1;
			}
		}

		// Update depth buffer with the distance of this ray
		depth_buffer[x] = ray.d;
	}
}

/** Render entities to the canvas */
function system_render_entities() {
	// Get all sprite components
	const sprites = components["sprite"];
	if (sprites === undefined) {
		return;
	}

	// Determine each entity's distance from the camera
	let order_index = 0;
	const order = new Array(sprites.size);
	const dist = {};
	for (const [id] of sprites) {
		order[order_index++] = id;
		const pos = get_entity_component(id, "pos");
		// ((camera_x - pos.x) * (camera_x - pos.x) + (camera_y - pos.y) * (camera_y - pos.y));
		dist[id] = distance(pos.x, pos.y, camera_x, camera_y);
	}

	// Sort entities by their distance from the camera
	order.sort(function (a, b) {
		return dist[b] - dist[a];
	});

	// Draw each sprite
	for (const id of order) {
		const pos = get_entity_component(id, "pos");

		const ex = pos.x - camera_x;
		const ey = pos.y - camera_y;

		// Required for correct matrix multiplication
		var inv_det =
			1.0 /
			(camera_plane_x * camera_facing_y - camera_facing_x * camera_plane_y);

		var tx = inv_det * (camera_facing_y * ex - camera_facing_x * ey);
		var ty = inv_det * (-camera_plane_y * ex + camera_plane_x * ey);

		var sx = Math.round((CAMERA_WIDTH / 2) * (1 + tx / ty));

		// Calculate sprite draw height
		const sprite_height = Math.abs(Math.round(CAMERA_HEIGHT / ty));
		const draw_start_y = -sprite_height / 2 + CAMERA_HEIGHT / 2;
		const draw_end_y = sprite_height / 2 + CAMERA_HEIGHT / 2;

		// Bail out if sprite is not visible
		if (draw_start_y > CAMERA_HEIGHT || draw_end_y < 0) {
			continue;
		}

		// Calculate sprite draw width
		const sprite_width = Math.abs(Math.round(CAMERA_HEIGHT / ty));
		const draw_start_x = Math.round(-sprite_width / 2 + sx);
		const draw_end_x = Math.round(sprite_width / 2 + sx);

		// Bail out if sprite is not visible
		if (draw_start_x > CAMERA_WIDTH || draw_end_x < 0) {
			continue;
		}

		// Draw sprite in vertical stripes
		for (let x = draw_start_x; x < draw_end_x; ++x) {
			if (ty > 0 && x > 0 && x < CAMERA_WIDTH && ty < depth_buffer[x]) {
				let texture_x = Math.floor(
					((x - (-sprite_width / 2 + sx)) * TEXTURE_SIZE) / sprite_width
				);
				texture_x += sprites.get(id).i * TEXTURE_SIZE;
				ctx.drawImage(
					textures,
					texture_x,
					0,
					1,
					TEXTURE_SIZE,
					x,
					~~draw_start_y,
					1,
					~~(draw_end_y - draw_start_y)
				);
			}
		}
	}
}

function system_render_ui() {
	for (const element of ui) {
		if (element.a <= 0) {
			continue;
		}
		ctx.globalAlpha = element.a;
		switch (element.e) {
			case 0: // Rectangle
				render_rect(element.x, element.y, element.w, element.h, element.c);
				break;
			case 1: // Text
				render_text(element.t, element.s, element.c, element.x, element.y);
				break;
		}
		ctx.globalAlpha = 1;
	}
}

/** Frame handler */
function frame(time) {
	// Calculate delta time
	const dt = (time - last_frame) / 1000;
	last_frame = time;

	// Execute systems
	if (dt < 0.2) {
		for (const sys of systems) {
			sys(dt);
		}
	}

	requestAnimationFrame(frame);
}

/** Scale drawing surface to the window size, maintaining aspect ratio */
function scale_canvas() {
	// Viewport width
	const width = window.innerWidth;
	const height = window.innerHeight;

	// Determine scale while maintaining aspect ratio
	const scale = Math.min(width / canvas.width, height / canvas.height);

	// Calculate centered position for scaled canvas
	const left = width / 2 - (canvas.width / 2) * scale;
	const top = height / 2 - (canvas.height / 2) * scale;

	// Apply styles
	canvas.style.width = `${canvas.width * scale}px`;
	canvas.style.height = `${canvas.height * scale}px`;
	canvas.style.left = `${left}px`;
	canvas.style.top = `${top}px`;
}

/** Main entry point */
function main() {
	// Load textures
	textures.src = "textures.png";

	// Initialize depth buffer
	depth_buffer = new Array(CAMERA_WIDTH);

	// Initialize drawing surface
	canvas = document.createElement("canvas");
	canvas.width = CAMERA_WIDTH;
	canvas.height = Math.floor(CAMERA_WIDTH / 2);
	canvas.style.position = "absolute";
	document.body.appendChild(canvas);
	scale_canvas();
	window.onresize = scale_canvas;
	ctx = canvas.getContext("2d");
	ctx.imageSmoothingEnabled = false;

	bg_buffer = document.createElement("canvas");
	bg_buffer.width = canvas.width;
	bg_buffer.height = canvas.height;
	const bg_ctx = bg_buffer.getContext("2d");
	const half_height = bg_buffer.height / 2;
	bg_ctx.fillStyle = "#000000";
	bg_ctx.fillRect(0, 0, CAMERA_WIDTH, half_height);
	bg_ctx.fillStyle = "#707070";
	bg_ctx.fillRect(0, half_height, CAMERA_WIDTH, half_height);
	bg_ctx.fillStyle = "#FFFFFF";
	const colors = [
		"#202040",
		"#340058",
		"#4c0000",
		"#9600dc",
		"#861650",
		"#006ab4",
	];
	for (let i = 0; i < 500; i++) {
		bg_ctx.fillStyle = random_pick(colors);
		bg_ctx.fillRect(random_int(bg_buffer.width), random_int(half_height), 2, 2);
	}

	// Init systems
	systems.push(
		system_input,
		system_behavior,
		system_physics,
		system_hazard,
		system_mortal,
		system_ttl,
		system_game,
		system_animation,
		system_tween,
		system_camera,
		system_render_map,
		system_render_entities,
		system_render_ui
	);

	generate_map(21, 21);

	set_camera(
		Math.floor(map_width / 2) + 0.5,
		Math.floor(map_height / 2) + 0.5,
		1,
		0
	);

	// Detect keyboard state
	window.onkeydown = (e) => handle_key(e, true);
	window.onkeyup = (e) => handle_key(e);

	game_timer = 0.5;

	// Start the main loop
	last_frame = performance.now();
	frame(last_frame);
}

// Execute program
main();
