//! Burgage zone subdivision — mirrors client burgageLayout.ts.

#[derive(Clone, Copy)]
pub struct Point2 {
    pub x: f64,
    pub z: f64,
}

#[derive(Clone, Copy)]
pub struct ZoneCorners {
    pub a: Point2,
    pub b: Point2,
    pub c: Point2,
    pub d: Point2,
}

pub struct ResidencePlacement {
    pub parcel_index: u32,
    pub x: f64,
    pub z: f64,
    pub yaw: f64,
}

pub struct BurgageLayout {
    pub plot_count: u32,
    pub residences: Vec<ResidencePlacement>,
}

const MIN_PLOT_FRONTAGE: f64 = 8.0;
const HOUSE_SETBACK: f64 = 3.5;
const MAIN_HOUSE_WIDTH: f64 = 6.6;
const MAIN_HOUSE_DEPTH: f64 = 7.4;
const MIN_PARCEL_DEPTH: f64 = MAIN_HOUSE_DEPTH + HOUSE_SETBACK + 2.5;
const MIN_ZONE_DEPTH: f64 = MIN_PARCEL_DEPTH;
const MAX_BACKYARD_DEPTH: f64 = 12.0;
const MAX_ZONE_DEPTH: f64 = MAIN_HOUSE_DEPTH + HOUSE_SETBACK + MAX_BACKYARD_DEPTH;
const ZONE_BOUNDARY_EPSILON: f64 = 0.12;

pub fn suggest_plot_count(frontage_length: f64) -> u32 {
    (frontage_length / MIN_PLOT_FRONTAGE).floor().max(1.0) as u32
}

pub fn measure_zone_depth(corners: &ZoneCorners, frontage_edge: u8) -> f64 {
    if frontage_edge > 3 {
        return 0.0;
    }
    let (front_start, front_end) = zone_edge(corners, frontage_edge);
    let rear_edge = (frontage_edge + 2) % 4;
    let (rear_end, rear_start) = zone_edge(corners, rear_edge);
    distance_point_to_segment(&front_start, &rear_start, &rear_end)
        .min(distance_point_to_segment(&front_end, &rear_start, &rear_end))
}

pub fn max_zone_depth() -> f64 {
    MAX_ZONE_DEPTH
}

pub fn min_zone_depth() -> f64 {
    MIN_ZONE_DEPTH
}

pub fn zone_corners_polygon(corners: &ZoneCorners) -> [Point2; 4] {
    [corners.a, corners.b, corners.c, corners.d]
}

pub fn convex_zones_overlap(a: &[Point2; 4], b: &[Point2; 4]) -> bool {
    convex_polygons_overlap(a, b, ZONE_BOUNDARY_EPSILON)
}

const BUILDING_FOOTPRINT_SCALE: f64 = 0.9;

pub fn building_footprint_polygon(x: f64, z: f64, pick_radius: f64) -> [Point2; 4] {
    let radius = pick_radius * BUILDING_FOOTPRINT_SCALE;
    [
        Point2 {
            x: x - radius,
            z: z - radius,
        },
        Point2 {
            x: x + radius,
            z: z - radius,
        },
        Point2 {
            x: x + radius,
            z: z + radius,
        },
        Point2 {
            x: x - radius,
            z: z + radius,
        },
    ]
}

pub fn zone_overlaps_footprint(zone: &[Point2; 4], x: f64, z: f64, pick_radius: f64) -> bool {
    let footprint = building_footprint_polygon(x, z, pick_radius);
    convex_polygons_overlap(zone, &footprint, ZONE_BOUNDARY_EPSILON)
}

pub fn compute_burgage_layout(
    corners: &ZoneCorners,
    frontage_edge: u8,
    requested_plot_count: u32,
) -> Option<BurgageLayout> {
    if frontage_edge > 3 {
        return None;
    }
    if !is_convex_quad(corners) {
        return None;
    }

    let (front_start, front_end) = zone_edge(corners, frontage_edge);
    let frontage_length = distance(&front_start, &front_end);
    if frontage_length < MIN_PLOT_FRONTAGE {
        return None;
    }

    let max_plot_count = suggest_plot_count(frontage_length);
    let plot_count = requested_plot_count.clamp(1, max_plot_count);

    let rear_edge = (frontage_edge + 2) % 4;
    let (rear_end, rear_start) = zone_edge(corners, rear_edge);
    let front_splits = split_edge(&front_start, &front_end, plot_count);
    let rear_splits = split_edge(&rear_start, &rear_end, plot_count);

    let mut residences = Vec::new();
    for i in 0..plot_count as usize {
        let front_left = front_splits[i];
        let front_right = front_splits[i + 1];
        let rear_right = rear_splits[i + 1];
        let rear_left = rear_splits[i];
        let polygon = vec![front_left, front_right, rear_right, rear_left];

        let parcel_frontage = distance(&front_left, &front_right);
        if parcel_frontage < MIN_PLOT_FRONTAGE * 0.92 {
            continue;
        }

        let parcel_depth = distance_point_to_segment(&front_left, &rear_left, &rear_right)
            .min(distance_point_to_segment(&front_right, &rear_left, &rear_right));
        if parcel_depth < MIN_PARCEL_DEPTH {
            continue;
        }

        let front_mid = midpoint(&front_left, &front_right);
        let front_dir = normalize(&Point2 {
            x: front_right.x - front_left.x,
            z: front_right.z - front_left.z,
        });
        let inward = pick_inward_normal(&front_mid, &front_dir, &polygon);
        let house_center = Point2 {
            x: front_mid.x + inward.x * (HOUSE_SETBACK + MAIN_HOUSE_DEPTH * 0.5),
            z: front_mid.z + inward.z * (HOUSE_SETBACK + MAIN_HOUSE_DEPTH * 0.5),
        };
        // Mesh door sits on local +Z; rotate so +Z points toward the road (-inward).
        let yaw = inward.x.atan2(-inward.z);
        if !footprint_fits(&house_center, yaw, &polygon) {
            continue;
        }

        residences.push(ResidencePlacement {
            parcel_index: i as u32,
            x: house_center.x,
            z: house_center.z,
            yaw,
        });
    }

    if residences.is_empty() {
        return None;
    }

    Some(BurgageLayout {
        plot_count: residences.len() as u32,
        residences,
    })
}

fn zone_edge(corners: &ZoneCorners, edge: u8) -> (Point2, Point2) {
    match edge {
        0 => (corners.a, corners.b),
        1 => (corners.b, corners.c),
        2 => (corners.c, corners.d),
        _ => (corners.d, corners.a),
    }
}

fn split_edge(start: &Point2, end: &Point2, segments: u32) -> Vec<Point2> {
    let mut points = Vec::with_capacity(segments as usize + 1);
    for i in 0..=segments {
        let t = i as f64 / segments as f64;
        points.push(Point2 {
            x: start.x + (end.x - start.x) * t,
            z: start.z + (end.z - start.z) * t,
        });
    }
    points
}

fn distance(a: &Point2, b: &Point2) -> f64 {
    ((a.x - b.x).powi(2) + (a.z - b.z).powi(2)).sqrt()
}

fn midpoint(a: &Point2, b: &Point2) -> Point2 {
    Point2 {
        x: (a.x + b.x) * 0.5,
        z: (a.z + b.z) * 0.5,
    }
}

fn normalize(v: &Point2) -> Point2 {
    let length = (v.x * v.x + v.z * v.z).sqrt();
    if length <= 1e-6 {
        return Point2 { x: 0.0, z: 1.0 };
    }
    Point2 {
        x: v.x / length,
        z: v.z / length,
    }
}

fn cross(a: &Point2, b: &Point2, c: &Point2) -> f64 {
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
}

fn is_convex_quad(corners: &ZoneCorners) -> bool {
    let signs = [
        cross(&corners.a, &corners.b, &corners.c).signum(),
        cross(&corners.b, &corners.c, &corners.d).signum(),
        cross(&corners.c, &corners.d, &corners.a).signum(),
        cross(&corners.d, &corners.a, &corners.b).signum(),
    ];
    if signs.iter().any(|value| *value == 0.0) {
        return false;
    }
    signs.windows(2).all(|pair| pair[0] == pair[1]) && signs[0] == signs[3]
}

fn distance_point_to_segment(point: &Point2, seg_start: &Point2, seg_end: &Point2) -> f64 {
    let abx = seg_end.x - seg_start.x;
    let abz = seg_end.z - seg_start.z;
    let length_sq = abx * abx + abz * abz;
    let t = if length_sq <= 1e-6 {
        0.0
    } else {
        (((point.x - seg_start.x) * abx + (point.z - seg_start.z) * abz) / length_sq).clamp(0.0, 1.0)
    };
    let px = seg_start.x + abx * t;
    let pz = seg_start.z + abz * t;
    ((point.x - px).powi(2) + (point.z - pz).powi(2)).sqrt()
}

fn pick_inward_normal(front_mid: &Point2, front_dir: &Point2, polygon: &[Point2]) -> Point2 {
    let left = Point2 {
        x: -front_dir.z,
        z: front_dir.x,
    };
    let right = Point2 {
        x: front_dir.z,
        z: -front_dir.x,
    };
    let left_probe = Point2 {
        x: front_mid.x + left.x,
        z: front_mid.z + left.z,
    };
    if is_point_in_polygon(&left_probe, polygon) {
        left
    } else {
        right
    }
}

fn is_point_in_polygon(point: &Point2, polygon: &[Point2]) -> bool {
    let mut inside = false;
    let mut j = polygon.len() - 1;
    for i in 0..polygon.len() {
        let xi = polygon[i].x;
        let zi = polygon[i].z;
        let xj = polygon[j].x;
        let zj = polygon[j].z;
        let intersects = (zi > point.z) != (zj > point.z)
            && point.x < (xj - xi) * (point.z - zi) / (zj - zi + 1e-9) + xi;
        if intersects {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn footprint_fits(center: &Point2, yaw: f64, polygon: &[Point2]) -> bool {
    let cos = yaw.cos();
    let sin = yaw.sin();
    let half_w = MAIN_HOUSE_WIDTH * 0.5;
    let half_d = MAIN_HOUSE_DEPTH * 0.5;
    let locals = [
        (-half_w, -half_d),
        (half_w, -half_d),
        (half_w, half_d),
        (-half_w, half_d),
    ];
    locals.iter().all(|(lx, lz)| {
        let world = Point2 {
            x: center.x + lx * cos - lz * sin,
            z: center.z + lx * sin + lz * cos,
        };
        is_point_in_polygon(&world, polygon)
    })
}

fn polygon_centroid(polygon: &[Point2]) -> Point2 {
    let mut x = 0.0;
    let mut z = 0.0;
    for point in polygon {
        x += point.x;
        z += point.z;
    }
    let count = polygon.len() as f64;
    Point2 {
        x: x / count,
        z: z / count,
    }
}

fn point_strictly_inside_polygon(point: &Point2, polygon: &[Point2], boundary_epsilon: f64) -> bool {
    if !is_point_in_polygon(point, polygon) {
        return false;
    }
    for i in 0..polygon.len() {
        let start = &polygon[i];
        let end = &polygon[(i + 1) % polygon.len()];
        if distance_point_to_segment(point, start, end) <= boundary_epsilon {
            return false;
        }
    }
    true
}

fn segments_intersect_properly(
    a1: &Point2,
    a2: &Point2,
    b1: &Point2,
    b2: &Point2,
    epsilon: f64,
) -> bool {
    let d1 = cross(b1, b2, a1);
    let d2 = cross(b1, b2, a2);
    let d3 = cross(a1, a2, b1);
    let d4 = cross(a1, a2, b2);
    ((d1 > epsilon && d2 < -epsilon) || (d1 < -epsilon && d2 > epsilon))
        && ((d3 > epsilon && d4 < -epsilon) || (d3 < -epsilon && d4 > epsilon))
}

fn convex_polygons_overlap(a: &[Point2], b: &[Point2], boundary_epsilon: f64) -> bool {
    let centroid_a = polygon_centroid(a);
    let centroid_b = polygon_centroid(b);

    for point in a.iter().chain(std::iter::once(&centroid_a)) {
        if point_strictly_inside_polygon(point, b, boundary_epsilon) {
            return true;
        }
    }
    for point in b.iter().chain(std::iter::once(&centroid_b)) {
        if point_strictly_inside_polygon(point, a, boundary_epsilon) {
            return true;
        }
    }

    for i in 0..a.len() {
        let a1 = &a[i];
        let a2 = &a[(i + 1) % a.len()];
        for j in 0..b.len() {
            let b1 = &b[j];
            let b2 = &b[(j + 1) % b.len()];
            if segments_intersect_properly(a1, a2, b1, b2, boundary_epsilon) {
                return true;
            }
        }
    }

    false
}
