---
id: "8a51d3d4-9c8f-4899-ade6-41cc11bc1274"
name: "Warp Core"
type: "artifact"
properties:
  type: "Energy Device"
  installed_on: "Dawnbreaker"
  power_output_zw: 12.7
  stability: 92
  manufacturer: "Lab Zero"
relationships:
  - target_id: "36d26e87-eb8f-44e1-9022-2d32e369a6c0"
    relation: "installed_on"
    properties:
      status: "Custom Matched"
  - target_id: "d0f67ea2-5904-47b9-bacd-831f823302a6"
    relation: "powers"
    properties:
      system: "Warp Engine"
constraints:
  - rule: "The Warp Core's energy output must not exceed 15 ZW; beyond this threshold, loss of control is imminent"
    severity: "hard"
tags:
  - "energy"
  - "core component"
  - "Dawnbreaker"
timeline_summary:
  - period: [220, 222]
    state: "Manufacturing Phase"
    location: "81640941-18a6-455e-8322-14c3f0ebc1cb"
    summary: "Lab Zero custom-built this warp core for the Dawnbreaker"
  - period: [222, 250]
    state: "Operational"
    location: "36d26e87-eb8f-44e1-9022-2d32e369a6c0"
    summary: "Continuously powering the Dawnbreaker with stable operation"
created_at: "2026-05-28T00:00:00+08:00"
updated_at: "2026-05-28T00:00:00+08:00"
---
# Warp Core

The Warp Core is the most sophisticated engineering artifact of the interstellar age. Each core is custom-built for its host starship — the Dawnbreaker's core outputs up to 12.7 zettawatts of energy, enough to power a city for a year.

The core's operating principles involve direct manipulation of the spacetime membrane, and only Lab Zero's core team knows the full details of its internal mechanisms. This extreme knowledge monopoly has spawned countless conspiracy theories: some believe every core contains a backdoor the Federation can remotely activate.

After Lin Yifeng's defection, the Federation did attempt to remotely shut down the Dawnbreaker's warp core. The attempt failed — Lin's engineering team had already removed every suspicious remote communication module.