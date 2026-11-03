//! Commit-graph lane layout.
//!
//! Input: commits newest-first (topological/date order). Output: for each row
//! the lane of the commit node plus the line segments to draw in that row.
//! Each row is drawn independently by the UI, which makes virtualized
//! rendering trivial.

use serde::Serialize;

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LineKind {
    /// From the top edge at lane `from` to the node center at lane `to`.
    Top,
    /// From the node center at lane `from` to the bottom edge at lane `to`.
    Bottom,
    /// Straight through the row, top to bottom, at lane `from` (== `to`).
    Pass,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct GraphLine {
    pub from: u16,
    pub to: u16,
    pub kind: LineKind,
    pub color: u16,
}

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
pub struct GraphRow {
    pub col: u16,
    pub color: u16,
    pub lines: Vec<GraphLine>,
}

struct Lane {
    expect: String,
    color: u16,
    /// Lane opened by a virtual row (WIP): its color must not leak into the
    /// real branch it joins.
    virtual_lane: bool,
}

pub struct LayoutInput<'a> {
    pub hash: &'a str,
    pub parents: &'a [String],
    /// Virtual row (the WIP pseudo-commit).
    pub virtual_row: bool,
}

fn free_slot(lanes: &mut Vec<Option<Lane>>, avoid: Option<usize>) -> usize {
    match lanes.iter().enumerate().position(|(i, l)| l.is_none() && Some(i) != avoid) {
        Some(i) => i,
        None => {
            lanes.push(None);
            lanes.len() - 1
        }
    }
}

/// Returns one `GraphRow` per input commit and the maximum number of lanes.
pub fn layout(commits: &[LayoutInput]) -> (Vec<GraphRow>, u16) {
    let mut lanes: Vec<Option<Lane>> = Vec::new();
    let mut rows = Vec::with_capacity(commits.len());
    let mut next_color: u16 = 0;
    let mut max_lanes: usize = 0;

    for c in commits {
        let matching: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter(|(_, l)| l.as_ref().is_some_and(|l| l.expect == c.hash))
            .map(|(i, _)| i)
            .collect();

        let mut lines = Vec::new();
        // Top half: every lane that is alive above this row.
        let col = matching.first().copied();
        for (i, lane) in lanes.iter().enumerate() {
            if let Some(lane) = lane {
                if matching.contains(&i) {
                    // Converges into the node; `col` is known because matching is non-empty.
                    lines.push(GraphLine { from: i as u16, to: col.unwrap() as u16, kind: LineKind::Top, color: lane.color });
                } else {
                    lines.push(GraphLine { from: i as u16, to: i as u16, kind: LineKind::Pass, color: lane.color });
                }
            }
        }

        // Prefer the color of a real lane; a node reached only through the
        // virtual WIP lane starts a fresh color.
        let real_color = matching
            .iter()
            .filter_map(|&i| lanes[i].as_ref())
            .find(|l| !l.virtual_lane)
            .map(|l| l.color);
        let (col, color) = match (col, real_color) {
            (Some(i), Some(color)) => (i, color),
            (Some(i), None) => {
                let color = next_color;
                next_color = next_color.wrapping_add(1);
                (i, color)
            }
            (None, _) => {
                // Branch tip: nothing above, open a new lane.
                let i = free_slot(&mut lanes, None);
                let color = next_color;
                next_color = next_color.wrapping_add(1);
                (i, color)
            }
        };

        for &i in matching.iter().skip(1) {
            lanes[i] = None;
        }

        if c.parents.is_empty() {
            lanes[col] = None;
        } else {
            lanes[col] = Some(Lane { expect: c.parents[0].clone(), color, virtual_lane: c.virtual_row });
            lines.push(GraphLine { from: col as u16, to: col as u16, kind: LineKind::Bottom, color });
            for p in &c.parents[1..] {
                let existing = lanes
                    .iter()
                    .enumerate()
                    .position(|(i, l)| i != col && l.as_ref().is_some_and(|l| &l.expect == p));
                let target = match existing {
                    Some(i) => i,
                    None => {
                        let i = free_slot(&mut lanes, Some(col));
                        lanes[i] = Some(Lane { expect: p.clone(), color: next_color, virtual_lane: c.virtual_row });
                        next_color = next_color.wrapping_add(1);
                        i
                    }
                };
                let lane_color = lanes[target].as_ref().unwrap().color;
                lines.push(GraphLine { from: col as u16, to: target as u16, kind: LineKind::Bottom, color: lane_color });
            }
        }

        max_lanes = max_lanes.max(lanes.len()).max(col + 1);
        while matches!(lanes.last(), Some(None)) {
            lanes.pop();
        }

        rows.push(GraphRow { col: col as u16, color, lines });
    }

    (rows, max_lanes as u16)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(spec: &[(&str, &[&str])]) -> Vec<GraphRow> {
        let parents: Vec<Vec<String>> = spec.iter().map(|(_, p)| p.iter().map(|s| s.to_string()).collect()).collect();
        let input: Vec<LayoutInput> = spec
            .iter()
            .zip(&parents)
            .map(|((h, _), p)| LayoutInput { hash: h, parents: p, virtual_row: *h == "WIP" })
            .collect();
        layout(&input).0
    }

    #[test]
    fn linear_history_stays_in_lane_zero() {
        let rows = run(&[("c", &["b"]), ("b", &["a"]), ("a", &[])]);
        assert!(rows.iter().all(|r| r.col == 0));
        assert_eq!(rows[2].lines, vec![GraphLine { from: 0, to: 0, kind: LineKind::Top, color: 0 }]);
    }

    #[test]
    fn merge_opens_and_closes_second_lane() {
        // m merges f into main; f and b both descend from a.
        let rows = run(&[("m", &["b", "f"]), ("f", &["a"]), ("b", &["a"]), ("a", &[])]);
        assert_eq!(rows[0].col, 0);
        assert!(rows[0].lines.iter().any(|l| l.kind == LineKind::Bottom && l.to == 1));
        assert_eq!(rows[1].col, 1); // f in second lane
        assert_eq!(rows[2].col, 0); // b back in main lane
        // a: both lanes converge
        assert_eq!(rows[3].col, 0);
        assert_eq!(rows[3].lines.iter().filter(|l| l.kind == LineKind::Top).count(), 2);
    }

    #[test]
    fn wip_lane_color_does_not_leak() {
        let rows = run(&[("WIP", &["b"]), ("b", &["a"]), ("a", &[])]);
        assert_eq!(rows[1].col, 0);
        assert_ne!(rows[0].color, rows[1].color);
        assert_eq!(rows[2].color, rows[1].color);
    }

    #[test]
    fn two_tips_get_two_lanes() {
        let rows = run(&[("x", &["a"]), ("y", &["a"]), ("a", &[])]);
        assert_eq!(rows[0].col, 0);
        assert_eq!(rows[1].col, 1);
        assert_ne!(rows[0].color, rows[1].color);
        assert_eq!(rows[2].col, 0);
    }
}
