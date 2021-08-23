"use strict";

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
const PLAYER_MOVE_SPEED = 4;

/** Player rotation speed, in radians per second */
const PLAYER_ROT_SPEED = Math.PI * 1;

/** Size of spatial lookup tiles, in map tiles */
const SPATIAL_TILE_SIZE = 2;

/** Key code which have their default behavior suppressed */
const SUPPRESS_KEYS = [13, 32, 37, 38, 39, 40, 65, 68, 83, 87];

/** Entity groups */
const GROUP_PLAYER = 1;
const GROUP_ENEMY = 2;

/** Collision groups (controls which groups collide with which other groups */
const COLLISION_GROUPS = new Map([
	[hash_ids(GROUP_PLAYER, GROUP_ENEMY), 1],
	[hash_ids(GROUP_ENEMY, GROUP_ENEMY), 1]
]);

/** Prefabricated entities */
const PREFABS = {
	player: {
		pos: { x: 0, y: 0, f: 0 },
		body: { w: 0.4, h: 0.4, vx: 0, vy: 0, b: 0, g: GROUP_PLAYER, c: [] },
		pla: { w: "pistol", c: 0 }
	},
	dummy: {
		pos: { x: 0, y: 0, f: 0 },
		body: { w: 0.5, h: 0.5, vx: 0, vy: 0, b: 1, g: GROUP_ENEMY, c: [] },
		mor: { h: 3 },
		sprite: { i: 1 }
	},
	slime: {
		pos: { x: 0, y: 0, f: 0 },
		body: { w: 0.8, h: 0.8, vx: 0, vy: 0, b: 1, g: GROUP_ENEMY, c: [] },
		mor: { h: 3 },
		sprite: { i: 6 },
		anim: { f: [6, 7], i: 0, d: 0.25, e: 0 },
	},
	bullet: {
		pos: { x: 0, y: 0, f: 0 },
		body: { w: 0.25, h: 0.25, vx: 0, vy: 0, b: 0, t: 1, g: GROUP_PLAYER, c: [] },
		bul: { d: 1 },
		sprite: { i: 2 }
	},
	boom: {
		pos: { x: 0, y: 0, f: 0 },
		sprite: { i: 3 },
		anim: { f: [3, 4, 5], i: 0, d: 0.125, e: 0 },
		ttl: { d: 0.375 }
	}
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
		s: 8,
		c: 0.4
	}
};

const MAP_GENERATORS = [
	(x, y, w, h) => (x % 4) === 0 && (y % 4) === 0,
	// (x, y, w, h) => (y % 4) !== 0 && ((x > 2 && x < w / 2 - 3) || (x < w - 3 && x > w / 2 + 3)),
];

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

/** Player entity */
let player_id = 0;

/** Simulation components */
const components = {};

/** Next entity ID */
let next_entity_id = 1;

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

function map_number(x, in_min, in_max, out_min, out_max) {
	return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
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
	for (let i = 0; i < map_tiles.length; i++) {
		const x = i % map_width;
		const y = Math.floor(i / map_width);
		map_tiles[i] = generator(x, y, width, height) ? 1 : 0;
		if (map_tiles[i] === 0 && Math.random() < 0.1) {
			const angle = Math.random() * Math.PI * 2;
			const prefab = random_pick(["dummy", "slime"]);
			const id = spawn_prefab_entity(prefab, x + 0.5, y + 0.5, 0);
			const body = get_entity_component(id, "body");
			body.vx = Math.cos(angle) * 0.75;
			body.vy = Math.sin(angle) * 0.75;
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
		if (keyboard[key]) { return true; }
	}
	return false;
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

/** Return the sign of a given number */
function sign(n) {
	return n > 0 ? 1 : n === 0 ? 0 : -1;
}

/** Hash two IDs into a unique number (order independent) */
function hash_ids(a, b) {
	return a < b ? idx(a, b, 100) : idx(b, a, 100);
}

/** Determine if two rectangles overlap */
function rect_overlap(a, b) {
	return (
		a.x < b.x + b.w &&
		a.x + a.w > b.x &&
		a.y < b.y + b.h &&
		a.y + a.h > b.y
	);
}

/** Calculate the intersection rectangle of overlapping rectangles */
function rect_intersection(a, b, out) {
	if (out === undefined) { out = {}; }
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
			const i = (y * map_width) + x;
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

// #############################################################################
// ### SYSTEMS #################################################################
// #############################################################################

/** User input system */
function system_input(dt) {
	const pla = get_entity_component(player_id, "pla");
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

/** Physics system */
function system_physics(dt) {
	const bodies = components.body;
	if (bodies === undefined) { return; }

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
						a: temp_rect.w * temp_rect.h
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
						const sx = sign((body.bb.x + body.bb.w / 2) - (temp_rect.x + temp_rect.w / 2));
						body.bb.x += temp_rect.w * sx;
						body.vx *= -body.b;
					} else {
						const sy = sign((body.bb.y + body.bb.h / 2) - (temp_rect.y + temp_rect.h / 2));
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
			if (neighbor_id === id) { continue; }
			const hash = hash_ids(id, neighbor_id);
			if (checked.indexOf(hash) !== -1) { continue; }
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

/** Bullet management system */
function system_bullet() {
	const bullets = components.bul;
	if (bullets === undefined) { return; }

	for (const [id, bullet] of bullets) {
		const body = get_entity_component(id, "body");
		if (body.c.length > 0) {
			const contact_id = body.c[0];
			const mortal = get_entity_component(contact_id, "mor");
			if (mortal !== undefined) {
				mortal.h -= bullet.d;
			}
		}
		if (body.e === 1 || body.c.length > 0) {
			remove_entity(id);
		}
	}
}

function system_mortal() {
	const mortals = components.mor;
	if (mortals === undefined) { return; }

	for (const [id, mortal] of mortals) {
		if (mortal.h <= 0) {
			const pos = get_entity_component(id, "pos");
			spawn_prefab_entity("boom", pos.x, pos.y, 0);
			remove_entity(id);
		}
	}
}

/** Camera management system */
function system_camera() {
	const pos = get_entity_component(player_id, "pos");
	set_camera(pos.x, pos.y, Math.cos(pos.f), Math.sin(pos.f));
}

function system_animation(dt) {
	const anims = components.anim;
	if (anims === undefined) { return; }

	for (const [id, anim] of anims) {
		anim.e += dt;
		if (anim.e >= anim.d) {
			anim.e -= anim.d;
			if (++anim.i >= anim.f.length) {
				anim.i = 0;
			}
			const sprite = get_entity_component(id, "sprite");
			sprite.i = anim.f[anim.i];
		}
	}
}

function system_ttl(dt) {
	const doomed = components.ttl;
	if (doomed === undefined) { return; }
	for (const [id, doom] of doomed) {
		doom.d -= dt;
		if (doom.d <= 0) {
			remove_entity(id);
		}
	}
}

/** Render the map/world to the canvas */
function system_render_map() {
	const half_height = CAMERA_HEIGHT / 2;

	const pos = get_entity_component(player_id, "pos");
	const angle = ((pos.f % TAU) + TAU) % TAU;
	const offset = Math.floor(map_number(angle, 0, TAU, 0, 1) * bg_buffer.width);

	ctx.fillStyle = "#F0F";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	if (offset === 0) {
		ctx.drawImage(bg_buffer, 0, 0);
	} else {
		// Left half
		ctx.drawImage(bg_buffer,
			offset, 0, bg_buffer.width - offset, bg_buffer.height,
			0, 0, bg_buffer.width - offset, bg_buffer.height);
		// Right half
		ctx.drawImage(bg_buffer,
			0, 0, offset, bg_buffer.height,
			bg_buffer.width - offset, 0, offset, bg_buffer.height);
	}

	for (let x = 0; x < CAMERA_WIDTH; x++) {
		const cam_x = 2 * x / CAMERA_WIDTH - 1; // x coordinate in camera space

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
			if (
				(ray.s === 0 && ray_x < 0) ||
				(ray.s === 1 && ray_y > 0)
			) {
				texture_x = TEXTURE_SIZE - texture_x - 1;
			}

			// offset texture coordinate within texture
			texture_x += (ray.v - 1) * TEXTURE_SIZE;

			ctx.drawImage(textures, texture_x, 0, 1, TEXTURE_SIZE, x, draw_start, 1, draw_end - draw_start);

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
	if (sprites === undefined) { return; }

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
		var inv_det = 1.0 / (camera_plane_x * camera_facing_y - camera_facing_x * camera_plane_y);

		var tx = inv_det * (camera_facing_y * ex - camera_facing_x * ey);
		var ty = inv_det * (-camera_plane_y * ex + camera_plane_x * ey);

		var sx = Math.round((CAMERA_WIDTH / 2) * (1 + tx / ty));

		// Calculate sprite draw height
		const sprite_height = Math.abs(Math.round(CAMERA_HEIGHT / (ty)));
		const draw_start_y = -sprite_height / 2 + CAMERA_HEIGHT / 2;
		const draw_end_y = sprite_height / 2 + CAMERA_HEIGHT / 2;

		// Bail out if sprite is not visible
		if (draw_start_y > CAMERA_HEIGHT || draw_end_y < 0) { continue; }

		// Calculate sprite draw width
		const sprite_width = Math.abs(Math.round(CAMERA_HEIGHT / (ty)));
		const draw_start_x = Math.round(-sprite_width / 2 + sx);
		const draw_end_x = Math.round(sprite_width / 2 + sx);

		// Bail out if sprite is not visible
		if (draw_start_x > CAMERA_WIDTH || draw_end_x < 0) { continue; }

		// Draw sprite in vertical stripes
		for (let x = draw_start_x; x < draw_end_x; ++x) {
			if (ty > 0 && x > 0 && x < CAMERA_WIDTH && ty < depth_buffer[x]) {
				let texture_x = Math.floor((x - (-sprite_width / 2 + sx)) * TEXTURE_SIZE / sprite_width);
				texture_x += sprites.get(id).i * TEXTURE_SIZE;
				ctx.drawImage(textures,
					texture_x, 0, 1, TEXTURE_SIZE,
					x, ~~draw_start_y, 1, ~~(draw_end_y - draw_start_y));
			}
		}
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
	const left = width / 2 - (canvas.width / 2 * scale);
	const top = height / 2 - (canvas.height / 2 * scale);

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
	const colors = ["#202040", "#340058", "#4c0000", "#9600dc", "#861650", "#006ab4"];
	for (let i = 0; i < 500; i++) {
		bg_ctx.fillStyle = random_pick(colors);
		bg_ctx.fillRect(random_int(bg_buffer.width), random_int(half_height), 2, 2);
	}

	// Init systems
	systems.push(
		system_input,
		system_physics,
		system_bullet,
		system_mortal,
		system_ttl,
		system_camera,
		system_render_map,
		system_animation,
		system_render_entities
	);

	// Init map
	generate_map(21, 21);

	// Init player
	player_id = spawn_prefab_entity("player", 1.5, 1.5, 0);

	// Detect keyboard state
	window.onkeydown = (e) => handle_key(e, true);
	window.onkeyup = (e) => handle_key(e);

	// Start the main loop
	last_frame = performance.now();
	frame(last_frame);
}

// Execute program
main();
