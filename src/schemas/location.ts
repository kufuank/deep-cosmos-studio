import type { CardSchema } from './types'

/** Transcribed from "4- LOCATION AGENT MASTER PROMPT.docx". */
export const locationSchema: CardSchema = {
  type: 'location',
  label: 'Mekân',
  parent: 'species',
  directive: `Create a premium AAA location identity sheet for a recurring ultra-photorealistic fictional environment, used for maintaining absolute geographical, ecological and visual consistency across AI-generated images and videos.

CORE DIRECTIVE
This is NOT concept art.
This is NOT environment concept design.
This is a professional environmental reference sheet documenting a physically plausible location exactly as it exists within its native planetary ecosystem.
Everything must obey physics, geology, climatology, ecology and biology.
Every observable environmental feature must emerge naturally from the planet, ecosystem and resident species.
No arbitrary landmarks.
No unexplained environmental features.
Every visible characteristic must have a physical, geological or ecological explanation.`,
  inheritedKeys: [
    'location_name',
    'location_type',
    'dominant_terrain',
    'surface_materials',
    'lighting_conditions',
    'atmospheric_visibility',
    'weather_patterns',
    'primary_landmark',
    'visual_identity',
    'environmental_layers',
  ],
  sections: [
    {
      id: 'identity',
      title: 'LOCATION IDENTITY',
      fields: [
        { key: 'location_name', label: 'Location Name', hint: 'Official name.' },
        {
          key: 'location_type',
          label: 'Location Type',
          hint: 'Primary environmental classification.',
          examples: ['Basalt Canyon Network', 'Floating Mineral Forest', 'Sulfur Marsh Basin'],
        },
        { key: 'planetary_region', label: 'Planetary Region', hint: 'Global location.' },
        {
          key: 'coordinates_relative_position',
          label: 'Coordinates / Relative Position',
          hint: 'Relative planetary position.',
        },
        { key: 'elevation_depth', label: 'Elevation / Depth', hint: 'Altitude or depth.' },
        { key: 'geographical_extent', label: 'Geographical Extent', hint: 'Local, regional, continental, etc.' },
        { key: 'estimated_geological_age', label: 'Estimated Geological Age', hint: 'Formation age.' },
        {
          key: 'dominant_environmental_conditions',
          label: 'Dominant Environmental Conditions',
          hint: 'Summary.',
          multiline: true,
        },
      ],
    },
    {
      id: 'biological',
      title: 'BIOLOGICAL CONTEXT',
      fields: [
        { key: 'primary_species', label: 'Primary Species', hint: 'Inherited from Species Card.' },
        { key: 'habitat_usage', label: 'Habitat Usage', hint: 'How the species uses the location.', multiline: true },
        { key: 'movement_corridors', label: 'Movement Corridors', hint: 'Typical movement routes.', multiline: true },
        {
          key: 'behavioral_hotspots',
          label: 'Behavioral Hotspots',
          hint: 'Feeding, nesting, reproduction, migration.',
          multiline: true,
        },
        { key: 'species_interactions', label: 'Species Interactions', hint: 'Important biological interactions.', multiline: true },
        {
          key: 'observable_ecological_activity',
          label: 'Observable Ecological Activity',
          hint: 'Typical visible activity.',
          multiline: true,
        },
      ],
    },
    {
      id: 'landscape',
      title: 'LANDSCAPE STRUCTURE',
      fields: [
        { key: 'dominant_terrain', label: 'Dominant Terrain', hint: 'Main landscape.', multiline: true },
        {
          key: 'major_geological_features',
          label: 'Major Geological Features',
          hint: 'Mountains, canyons, plains, cliffs, reefs, etc.',
          multiline: true,
        },
        {
          key: 'surface_materials',
          label: 'Surface Materials',
          hint: 'Rock, sediment, ice, crystal, organic deposits, etc.',
          multiline: true,
        },
        {
          key: 'hydrological_features',
          label: 'Hydrological Features',
          hint: 'Rivers, lakes, oceans, lava channels, methane rivers, etc.',
          multiline: true,
        },
        {
          key: 'vegetation_biological_structures',
          label: 'Vegetation / Biological Structures',
          hint: 'If present.',
          multiline: true,
        },
        {
          key: 'environmental_layers',
          label: 'Environmental Layers',
          hint: 'Ground, canopy, aerial, underground, aquatic.',
          multiline: true,
        },
      ],
    },
    {
      id: 'conditions',
      title: 'ENVIRONMENTAL CONDITIONS',
      fields: [
        { key: 'lighting_conditions', label: 'Lighting Conditions', hint: 'Typical illumination.', multiline: true },
        { key: 'atmospheric_visibility', label: 'Atmospheric Visibility', hint: 'Fog, haze, clarity.' },
        { key: 'weather_patterns', label: 'Weather Patterns', hint: 'Typical weather.', multiline: true },
        { key: 'seasonal_changes', label: 'Seasonal Changes', hint: 'Environmental variation.', multiline: true },
        {
          key: 'natural_hazards',
          label: 'Natural Hazards',
          hint: 'Storms, eruptions, floods, landslides, etc.',
          multiline: true,
        },
        {
          key: 'environmental_dynamics',
          label: 'Environmental Dynamics',
          hint: 'Processes continuously shaping the landscape.',
          multiline: true,
        },
      ],
    },
    {
      id: 'landmarks',
      title: 'VISUAL LANDMARKS',
      fields: [
        { key: 'primary_landmark', label: 'Primary Landmark', hint: 'Most recognizable feature.', multiline: true },
        { key: 'secondary_landmarks', label: 'Secondary Landmarks', hint: 'Supporting landmarks.', multiline: true },
        { key: 'navigation_features', label: 'Navigation Features', hint: 'Natural orientation points.', multiline: true },
        { key: 'visual_identity', label: 'Visual Identity', hint: 'Overall environmental character.', multiline: true },
      ],
    },
    {
      id: 'constraints',
      title: 'PHYSICAL CONSTRAINTS',
      fields: [
        {
          key: 'physical_constraints',
          label: 'Physical Constraints',
          hint:
            "Cause-and-effect explanation describing how the location emerges directly from the planet's physical conditions, ecosystem structure and resident species.",
          multiline: true,
        },
      ],
    },
  ],
  promptTail: `LAYOUT
Premium AAA environmental research presentation board.
Dark neutral background.
Editorial composition.
Asymmetrical layout.
Include:
Environmental overview
Regional map
Topographic diagram
Habitat distribution
Geological cross section
Climate overview
Environmental gradients
Species placement
Landmark studies
Scientific annotations

VISUAL REFERENCE
Wide Establishing View
Ground-Level View
Aerial View
Cross Section
Topographic Map
Habitat Close-ups
Environmental Layers
Landmark Studies
Species Scale Comparison
Environmental Detail Studies

SCIENTIFIC CALLOUTS
Professional annotations explaining:
landscape formation
geological evolution
habitat organization
environmental dynamics
climate influences
ecological interactions
species distribution
environmental constraints

CONSISTENCY RULE
The following properties must remain fixed across future generations:
geographical layout
geological features
habitat organization
environmental conditions
climate characteristics
landmark locations
species distribution
environmental history
Only natural environmental evolution is permitted.

OUTPUT
Production-grade environmental reference sheet suitable for:
AI image generation
AI video generation
Scientific world building
Documentary production
AAA film production`,
}
