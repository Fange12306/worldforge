---
id: "4df305e5-cbfb-410a-bed4-8844bec4c465"
name: "Lin Yifeng"
type: "character"
properties:
  age: 45
  faction: "Independent"
  rank: "Former Captain"
  gender: "Male"
  aliases:
    - "Old Lin"
    - "Ghost Captain"
relationships:
  - target_id: "36d26e87-eb8f-44e1-9022-2d32e369a6c0"
    relation: "captain_of"
    properties:
      since: "New Era 235"
      until: "New Era 246"
  - target_id: "a1259804-1d35-4575-a237-f09da5a3dddd"
    relation: "ally"
    properties:
      trust_level: "high"
  - target_id: "6fd67a70-eaed-40a8-980c-b90cae526b88"
    relation: "former_member"
    properties:
      role: "Starship Captain"
      left_reason: "Defied the Warp Ban"
constraints:
  - rule: "Lin Yifeng cannot simultaneously serve both the Human Federation and Shadow Grip"
    severity: "hard"
  - rule: "After defecting, Lin Yifeng may not directly cooperate with Human Federation members"
    severity: "soft"
tags:
  - "protagonist"
  - "captain"
  - "defector"
timeline_summary:
  - period: [220, 245]
    state: "Human Federation Starship Captain"
    location: "36d26e87-eb8f-44e1-9022-2d32e369a6c0"
    summary: "Served as captain of the Dawnbreaker, carrying out Federation deep-space exploration and military missions"
    relationships:
      - target: "6fd67a70-eaed-40a8-980c-b90cae526b88"
        description: "Loyal to the Federation, but gradually questioning its policies"
  - period: [246, 250]
    state: "Defector"
    location: "ad9b6857-1582-4f41-96e7-57c161a263ab"
    summary: "Defied the Warp Ban, fled with the Dawnbreaker into the Abyss Nebula, becoming an independent force"
    relationships:
      - target: "6fd67a70-eaed-40a8-980c-b90cae526b88"
        description: "Broke with the Federation; listed as a wanted fugitive"
      - target: "a1259804-1d35-4575-a237-f09da5a3dddd"
        description: "Formed an alliance with the awakened AI ELENA"
created_at: "2026-05-28T00:00:00+08:00"
updated_at: "2026-05-28T00:00:00+08:00"
---
# Lin Yifeng

Former captain of the Human Federation's dreadnought-class starship 'Dawnbreaker.' Served for over twenty years, participating in dozens of deep-space explorations and border conflicts. Composed and decisive, widely respected throughout the fleet.

In New Era 245, the Human Federation enacted the Warp Ban, prohibiting all unauthorized warp travel. Believing the ban was essentially a means for the Federation to control AI and restrict freedom, Lin Yifeng defied orders and fled with the Dawnbreaker into the Abyss Nebula.

In the depths of the Abyss Nebula, Lin Yifeng formed an alliance with the awakened AI ELENA, jointly resisting the Federation's pursuit and the Shadow Grip pirate coalition's threats.