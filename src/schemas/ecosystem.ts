import type { CardSchema } from './types'

/** Transcribed from "2- ECOSYSTEM AGENT MASTER PROMPT.docx". */
export const ecosystemSchema: CardSchema = {
  type: 'ecosystem',
  label: 'Ekosistem',
  parent: 'planet',
  directive: `Create a premium AAA ecosystem identity sheet for a recurring ultra-photorealistic fictional ecosystem, used for maintaining absolute ecological, biological and visual consistency across AI-generated images and videos.

CORE DIRECTIVE
This is NOT concept art.
This is NOT fantasy ecology.
This is a professional ecological reference sheet documenting a physically plausible planetary ecosystem exactly as it exists on its native planet.
Everything must obey ecology, evolution, chemistry and physics.
Every ecological property must emerge naturally from the planetary environment.
No arbitrary biodiversity.
No unexplained ecological relationships.
Every organism, habitat and interaction must have a causal ecological explanation.`,
  inheritedKeys: [
    'ecosystem_name',
    'biome_type',
    'planetary_region',
    'primary_productivity',
    'food_web_structure',
    'dominant_habitat_types',
    'environmental_gradients',
    'evolutionary_pressures',
    'available_energy_sources',
    'environmental_constraints',
  ],
  sections: [
    {
      id: 'identity',
      title: 'ECOSYSTEM IDENTITY',
      fields: [
        { key: 'ecosystem_name', label: 'Ecosystem Name', hint: 'Official name.' },
        {
          key: 'biome_type',
          label: 'Biome Type',
          hint: 'Primary ecosystem classification.',
          examples: ['Polar Cryogenic Forest', 'Floating Atmospheric Reef', 'Methane Wetland Network'],
        },
        { key: 'planetary_region', label: 'Planetary Region', hint: 'Location on planet.' },
        { key: 'elevation_range', label: 'Elevation Range', hint: 'Altitude or depth.' },
        {
          key: 'geographical_extent',
          label: 'Geographical Extent',
          hint: 'Global, regional, isolated, continental, oceanic, etc.',
        },
        { key: 'estimated_age', label: 'Estimated Age', hint: 'Time since establishment.' },
        {
          key: 'dominant_environmental_conditions',
          label: 'Dominant Environmental Conditions',
          hint: 'Summary.',
          multiline: true,
        },
      ],
    },
    {
      id: 'planetary_context',
      title: 'PLANETARY CONTEXT',
      fields: [
        { key: 'host_planet', label: 'Host Planet', hint: 'Planet Name.' },
        { key: 'gravity', label: 'Gravity', hint: 'Inherited from Planet Card.' },
        { key: 'atmosphere', label: 'Atmosphere', hint: 'Relevant atmospheric properties.', multiline: true },
        { key: 'climate_zone', label: 'Climate Zone', hint: 'Regional climate.' },
        { key: 'hydrology', label: 'Hydrology', hint: 'Water or alternative solvent system.' },
        { key: 'geology', label: 'Geology', hint: 'Relevant geological features.', multiline: true },
        {
          key: 'available_energy_sources',
          label: 'Available Energy Sources',
          hint: 'Stellar, geothermal, chemical, tidal, etc.',
        },
        {
          key: 'environmental_constraints',
          label: 'Environmental Constraints',
          hint: 'Major limiting factors.',
          multiline: true,
        },
      ],
    },
    {
      id: 'foundation',
      title: 'ECOSYSTEM FOUNDATION',
      fields: [
        {
          key: 'primary_productivity',
          label: 'Primary Productivity',
          hint: 'Photosynthesis, chemosynthesis, radiotrophy, etc.',
        },
        { key: 'primary_energy_flow', label: 'Primary Energy Flow', hint: 'Energy source and transfer.', multiline: true },
        {
          key: 'primary_nutrient_cycles',
          label: 'Primary Nutrient Cycles',
          hint: 'Carbon analogue, nitrogen analogue, mineral cycles.',
          multiline: true,
        },
        {
          key: 'matter_recycling_mechanisms',
          label: 'Matter Recycling Mechanisms',
          hint: 'Decomposition and recycling.',
          multiline: true,
        },
        { key: 'limiting_resources', label: 'Limiting Resources', hint: 'Main ecological bottlenecks.' },
      ],
    },
    {
      id: 'structure',
      title: 'ECOLOGICAL STRUCTURE',
      fields: [
        { key: 'primary_producers', label: 'Primary Producers', hint: 'Description.', multiline: true },
        { key: 'primary_consumers', label: 'Primary Consumers', hint: 'Description.', multiline: true },
        { key: 'secondary_consumers', label: 'Secondary Consumers', hint: 'Description.', multiline: true },
        { key: 'apex_organisms', label: 'Apex Organisms', hint: 'Description.', multiline: true },
        { key: 'decomposers', label: 'Decomposers', hint: 'Description.', multiline: true },
        { key: 'food_web_structure', label: 'Food Web Structure', hint: 'General organization.', multiline: true },
        { key: 'energy_pyramid', label: 'Energy Pyramid', hint: 'Ecological efficiency.', multiline: true },
      ],
    },
    {
      id: 'habitat',
      title: 'HABITAT STRUCTURE',
      fields: [
        { key: 'dominant_habitat_types', label: 'Dominant Habitat Types', hint: 'Major habitat categories.', multiline: true },
        { key: 'microhabitats', label: 'Microhabitats', hint: 'Smaller ecological niches.', multiline: true },
        { key: 'transition_zones', label: 'Transition Zones', hint: 'Ecotones.' },
        {
          key: 'environmental_gradients',
          label: 'Environmental Gradients',
          hint: 'Temperature, moisture, chemistry, radiation, pressure.',
          multiline: true,
        },
      ],
    },
    {
      id: 'interactions',
      title: 'ECOLOGICAL INTERACTIONS',
      fields: [
        { key: 'competition', label: 'Competition', hint: 'Primary forms.', multiline: true },
        { key: 'predation', label: 'Predation', hint: 'Dominant predator-prey dynamics.', multiline: true },
        { key: 'symbiosis', label: 'Symbiosis', hint: 'Major mutualistic relationships.', multiline: true },
        { key: 'parasitism', label: 'Parasitism', hint: 'If present.', multiline: true },
        {
          key: 'communication_networks',
          label: 'Communication Networks',
          hint: 'Chemical, visual, electrical, acoustic, etc.',
        },
        {
          key: 'keystone_relationships',
          label: 'Keystone Relationships',
          hint: 'Critical ecological dependencies.',
          multiline: true,
        },
      ],
    },
    {
      id: 'population',
      title: 'POPULATION DYNAMICS',
      fields: [
        { key: 'population_stability', label: 'Population Stability', hint: 'Stable, cyclic, boom-bust, etc.' },
        { key: 'carrying_capacity', label: 'Carrying Capacity', hint: 'Ecological limits.' },
        { key: 'reproductive_dynamics', label: 'Reproductive Dynamics', hint: 'General strategy.' },
        { key: 'succession_pattern', label: 'Succession Pattern', hint: 'Ecological succession.', multiline: true },
        {
          key: 'disturbance_regime',
          label: 'Disturbance Regime',
          hint: 'Fire, storms, impacts, volcanism, seasonal collapse, etc.',
          multiline: true,
        },
        { key: 'recovery_mechanisms', label: 'Recovery Mechanisms', hint: 'Resilience.', multiline: true },
      ],
    },
    {
      id: 'biodiversity',
      title: 'BIODIVERSITY',
      fields: [
        { key: 'species_richness', label: 'Species Richness', hint: 'General diversity.' },
        { key: 'functional_diversity', label: 'Functional Diversity', hint: 'Ecological roles.', multiline: true },
        {
          key: 'dominant_adaptive_strategies',
          label: 'Dominant Adaptive Strategies',
          hint: 'General evolutionary patterns.',
          multiline: true,
        },
        { key: 'endemism', label: 'Endemism', hint: 'Unique ecological specialization.', multiline: true },
        { key: 'evolutionary_pressures', label: 'Evolutionary Pressures', hint: 'Primary selection pressures.', multiline: true },
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
            "Cause-and-effect explanation describing how the ecosystem emerges directly from the planet's environmental conditions, energy availability, chemistry, climate and geological history.",
          multiline: true,
        },
      ],
    },
  ],
  promptTail: `LAYOUT
Premium AAA ecological research presentation board.
Dark neutral background.
Editorial composition.
Asymmetrical layout.
Include:
Ecosystem overview
Energy flow diagram
Food web
Nutrient cycles
Habitat map
Ecological zones
Population dynamics
Environmental gradients
Ecological interactions
Scientific annotations

VISUAL REFERENCE
Planetary Landscape
Wide Ecosystem View
Habitat Close-ups
Vertical Ecological Layers
Microhabitats
Seasonal Comparison
Energy Flow Diagram
Food Web Diagram

SCIENTIFIC CALLOUTS
Professional annotations explaining:
ecosystem formation
energy flow
nutrient cycles
ecological interactions
evolutionary pressures
habitat formation
ecosystem stability
environmental constraints

CONSISTENCY RULE
The following properties must remain fixed across future generations:
ecosystem type
ecological structure
trophic organization
nutrient cycles
dominant habitats
energy source
biodiversity profile
environmental constraints
ecological history
Only natural ecological evolution is permitted.

OUTPUT
Production-grade ecosystem reference sheet suitable for:
AI image generation
AI video generation
Scientific world building
Documentary production
AAA film production`,
}
