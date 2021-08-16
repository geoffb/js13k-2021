"use strict";

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
const PLAYER_ROT_SPEED = Math.PI * 1.2;

/** Size of spatial lookup tiles, in map tiles */
const SPATIAL_TILE_SIZE = 2;

/** Key code which have their default behavior suppressed */
const SUPPRESS_KEYS = [32, 37, 38, 39, 40, 65, 68, 83, 87];

/** Prefabricated entities */
const PREFABS = {
	player: {
		pos: { x: 0, y: 0, f: 0 },
		body: { w: 0.4, h: 0.4, vx: 0, vy: 0, b: 0 }
	},
	dummy: {
		pos: { x: 0, y: 0, f: 0 },
		body: { w: 0.5, h: 0.5, vx: 0, vy: 0, b: 1 },
		sprite: { i: 1 }
	}
};

/** Keyboard state */
const keyboard = {};

/** Time of the last frame */
let last_frame = 0;

/** Canvas 2D drawing surface */
let canvas;
let ctx;

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

function clear_spatial_map() {
	for (const bucket of spatial_tiles) {
		bucket.length = 0;
	}
}

function insert_spatial_bounds(id, bb) {
	const ox = Math.floor(bb.x / SPATIAL_TILE_SIZE);
	const oy = Math.floor(bb.y / SPATIAL_TILE_SIZE);
	const tx = Math.floor((bb.x + bb.w) / SPATIAL_TILE_SIZE);
	const ty = Math.floor((bb.y + bb.h) / SPATIAL_TILE_SIZE);
	for (let y = oy; y <= ty; y++) {
		for (let x = ox; x <= tx; x++) {
			const index = (y * spatial_width) + x;
			spatial_tiles[index].push(id);
		}
	}
}

function get_spatial_neighbors(bb) {
	const neighbors = [];
	const ox = Math.floor(bb.x / SPATIAL_TILE_SIZE);
	const oy = Math.floor(bb.y / SPATIAL_TILE_SIZE);
	const tx = Math.floor((bb.x + bb.w) / SPATIAL_TILE_SIZE);
	const ty = Math.floor((bb.y + bb.h) / SPATIAL_TILE_SIZE);
	for (let y = oy; y <= ty; y++) {
		for (let x = ox; x <= tx; x++) {
			const index = (y * spatial_width) + x;
			neighbors.push(...spatial_tiles[index]);
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

/** Return the sign of a given number */
function sign(n) {
	return n > 0 ? 1 : n === 0 ? 0 : -1;
}

function hash_ids(a, b) {
	return a < b ? (a * 100 + b) : (b * 100 + a);
}

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
	const pos = get_entity_component(player_id, "pos");
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
}

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
		const pos = get_entity_component(id, "pos");
		pos.x += body.vx * dt;
		pos.y += body.vy * dt;

		update_bounding_box(pos, body);

		// Constrain physical bodies to the map
		if (body.bb.x < 0) {
			body.bb.x = 0;
		} else if (body.bb.x + body.bb.w >= map_width) {
			body.bb.x = map_width - body.bb.w;
		}
		if (body.bb.y < 0) {
			body.bb.y = 0;
		} else if (body.bb.y + body.bb.h >= map_height) {
			body.bb.y = map_height - body.bb.h;
		}

		// Detect tile map collisions
		const ox = Math.floor(body.bb.x);
		const oy = Math.floor(body.bb.y);
		const tx = Math.floor(body.bb.x + body.bb.w);
		const ty = Math.floor(body.bb.y + body.bb.h);
		const tiles = [];
		for (let y = oy; y <= ty; y++) {
			for (let x = ox; x <= tx; x++) {
				const index = y * map_width + x;
				if (map_tiles[index] > 0) {
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
			if (rect_overlap(body.bb, neighbor_body.bb)) {
				pairs.push([id, neighbor_id, rect_intersection(body.bb, neighbor_body.bb)]);
			}
		}
	}

	// Resolve colliding pairs
	for (const [a, b, intersection] of pairs) {
		// TODO: Allow for static vs dynamic collisions
		const body_a = get_entity_component(a, "body");
		const body_b = get_entity_component(b, "body");
		const pos_a = get_entity_component(a, "pos");
		const pos_b = get_entity_component(b, "pos");
		if (intersection.w < intersection.h) {
			// Separate along the X axis
			const hw = intersection.w / 2;
			const ix = intersection.x + hw;
			pos_a.x += hw * sign(pos_a.x - ix);
			pos_b.x += hw * sign(pos_b.x - ix);
			body_a.vx *= -body_a.b;
			body_b.vx *= -body_b.b;
		} else {
			// Separate along the Y axis
			const hh = intersection.h / 2;
			const iy = intersection.y + hh;
			pos_a.y += hh * sign(pos_a.y - iy);
			pos_b.y += hh * sign(pos_b.y - iy);
			body_a.vy *= -body_a.b;
			body_b.vy *= -body_b.b;
		}
		update_bounding_box(pos_a, body_a);
		update_bounding_box(pos_b, body_b);
	}
}

/** Camera management system */
function system_camera() {
	const pos = get_entity_component(player_id, "pos");
	set_camera(pos.x, pos.y, Math.cos(pos.f), Math.sin(pos.f));
}

/** Render the map/world to the canvas */
function system_render_map() {
	const half_height = CAMERA_HEIGHT / 2;

	// Draw ceiling/sky
	ctx.fillStyle = "#27badb";
	ctx.fillRect(0, 0, CAMERA_WIDTH, half_height);

	// Draw floor
	ctx.fillStyle = "#707070";
	ctx.fillRect(0, half_height, CAMERA_WIDTH, half_height);

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
	const distance = {};
	for (const [id] of sprites) {
		order[order_index++] = id;
		const pos = get_entity_component(id, "pos");
		distance[id] = ((camera_x - pos.x) * (camera_x - pos.x) + (camera_y - pos.y) * (camera_y - pos.y));
	}

	// Sort entities by their distance from the camera
	order.sort(function (a, b) {
		return distance[b] - distance[a];
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
	for (const sys of systems) {
		sys(dt);
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

	// Init systems
	systems.push(
		system_input,
		system_physics,
		system_camera,
		system_render_map,
		system_render_entities
	);

	// Init map
	init_map(20, 20);
	for (let i = 0; i < map_tiles.length; i++) {
		const x = i % map_width;
		const y = Math.floor(i / map_width);
		if (x === 0 || x === map_width - 1 || y === 0 || y === map_height - 1) {
			map_tiles[i] = 1;
		} else {
			map_tiles[i] = Math.random() > 0.1 ? 0 : 1;
			if (map_tiles[i] === 0 && Math.random() < 0.05) {
				const angle = Math.random() * Math.PI * 2;
				const id = spawn_prefab_entity("dummy", x + 0.5, y + 0.5, 0);
				const body = get_entity_component(id, "body");
				body.vx = Math.cos(angle) * 0.75;
				body.vy = Math.sin(angle) * 0.75;
			}
		}
	}

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
