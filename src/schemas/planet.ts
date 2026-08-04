import type { CardSchema } from './types'

/**
 * Transcribed from "1- PLANET AGENT MASTER PROMPT.docx" — PLANET IDENTITY SHEET
 * PROMPT TEMPLATE. Field order and hints follow the document exactly.
 */
export const planetSchema: CardSchema = {
  type: 'planet',
  label: 'Gezegen',
  parent: null,
  directive: `Create a premium AAA planetary identity sheet for a recurring ultra-photorealistic fictional planet, used for maintaining absolute scientific, geological and visual consistency across AI-generated images and videos.

CORE DIRECTIVE
This is NOT concept art.
This is NOT space illustration.
This is a professional planetary science reference sheet documenting a physically plausible planet exactly as it exists inside its native star system.
Everything must obey real physics.
Every planetary characteristic must be causally justified by its formation history and environmental conditions.
No arbitrary fantasy features or unexplained visual features. Every observable feature must have a scientific explanation.`,
  inheritedKeys: [
    'planet_name',
    'planet_type',
    'surface_gravity',
    'atmosphere_composition',
    'atmosphere_pressure',
    'global_climate',
    'temperature_range',
    'liquid_distribution',
    'dominant_terrain',
    'surface_coloration',
    'primary_energy_source',
    'atmospheric_optics',
  ],
  sections: [
    {
      id: 'identity',
      title: 'PLANET IDENTITY',
      fields: [
        { key: 'planet_name', label: 'Planet Name', hint: 'Official name.' },
        {
          key: 'planet_type',
          label: 'Planet Type',
          hint: 'Primary planetary class.',
          examples: [
            'Terrestrial',
            'Ocean World',
            'Ice World',
            'Gas Giant',
            'Ice Giant',
            'Desert Planet',
            'Lava World',
            'Super Earth',
            'Rogue Planet',
          ],
        },
        { key: 'parent_star_system', label: 'Parent Star System', hint: 'Host star(s).' },
        { key: 'orbital_position', label: 'Orbital Position', hint: 'Orbital distance and configuration.' },
        { key: 'age', label: 'Age', hint: 'Planetary age.' },
        { key: 'mass', label: 'Mass', hint: 'Planetary mass.' },
        { key: 'radius', label: 'Radius', hint: 'Planetary radius.' },
        { key: 'density', label: 'Density', hint: 'Average density.' },
        { key: 'surface_gravity', label: 'Surface Gravity', hint: 'Surface gravity.' },
        { key: 'rotation_period', label: 'Rotation Period', hint: 'Day length.' },
        { key: 'orbital_period', label: 'Orbital Period', hint: 'Year length.' },
        { key: 'axial_tilt', label: 'Axial Tilt', hint: 'Tilt angle.' },
      ],
    },
    {
      id: 'stellar',
      title: 'STELLAR ENVIRONMENT',
      fields: [
        { key: 'host_star', label: 'Host Star', hint: 'Type, mass, luminosity.' },
        { key: 'multiple_star_configuration', label: 'Multiple Star Configuration', hint: 'If applicable.' },
        { key: 'incident_radiation', label: 'Incident Radiation', hint: 'Stellar energy.' },
        { key: 'habitable_zone_position', label: 'Habitable Zone Position', hint: 'Location relative to habitable zone.' },
        { key: 'primary_energy_source', label: 'Primary Energy Source', hint: 'Main source of planetary energy.' },
        { key: 'parent_star_appearance', label: 'Parent Star Appearance', hint: 'Visual appearance.' },
        { key: 'nearby_celestial_bodies', label: 'Nearby Celestial Bodies', hint: 'Moons, planets, rings.' },
        { key: 'sky_appearance', label: 'Sky Appearance', hint: 'Day sky.', multiline: true },
        { key: 'night_sky', label: 'Night Sky', hint: 'Night sky.', multiline: true },
        { key: 'solar_events', label: 'Solar Events', hint: 'Flares, eclipses, auroras.' },
      ],
    },
    {
      id: 'formation',
      title: 'PLANETARY FORMATION',
      fields: [
        { key: 'formation_mechanism', label: 'Formation Mechanism', hint: 'Formation history.', multiline: true },
        { key: 'primary_building_materials', label: 'Primary Building Materials', hint: 'Dominant composition.' },
        { key: 'differentiation', label: 'Differentiation', hint: 'Core, mantle, crust.' },
        { key: 'evolutionary_history', label: 'Evolutionary History', hint: 'Major geological milestones.', multiline: true },
        { key: 'major_geological_events', label: 'Major Geological Events', hint: 'Impacts, volcanism, crust formation.', multiline: true },
        { key: 'atmospheric_evolution', label: 'Atmospheric Evolution', hint: 'How the atmosphere developed.', multiline: true },
        { key: 'climate_evolution', label: 'Climate Evolution', hint: 'Long-term climatic evolution.', multiline: true },
        { key: 'current_stable_state', label: 'Current Stable State', hint: 'Present equilibrium.', multiline: true },
      ],
    },
    {
      id: 'internal',
      title: 'INTERNAL STRUCTURE',
      fields: [
        { key: 'core', label: 'Core', hint: 'Composition.' },
        { key: 'mantle', label: 'Mantle', hint: 'Structure.' },
        { key: 'crust', label: 'Crust', hint: 'Thickness.' },
        { key: 'internal_heat_source', label: 'Internal Heat Source', hint: 'Radioactive decay, tidal heating, residual heat.' },
        { key: 'plate_activity', label: 'Plate Activity', hint: 'Tectonic regime.' },
        { key: 'volcanic_activity', label: 'Volcanic Activity', hint: 'Global characteristics.' },
      ],
    },
    {
      id: 'atmosphere',
      title: 'ATMOSPHERE',
      fields: [
        {
          key: 'atmosphere_composition',
          label: 'Composition',
          hint: 'Primary gases.',
          examples: ['Dense methane atmosphere', 'Sulfuric acid clouds', 'Nitrogen-oxygen atmosphere'],
        },
        { key: 'atmosphere_pressure', label: 'Pressure', hint: 'Surface pressure.' },
        { key: 'atmosphere_density', label: 'Density', hint: 'Atmospheric density.' },
        { key: 'cloud_system', label: 'Cloud System', hint: 'Cloud composition.' },
        { key: 'weather', label: 'Weather', hint: 'Dominant weather and Temperature Range.', multiline: true },
        { key: 'atmospheric_dynamics', label: 'Atmospheric Dynamics', hint: 'Circulation.', multiline: true },
        { key: 'atmospheric_optics', label: 'Atmospheric Optics', hint: 'Sky color, scattering, sunsets, visibility.', multiline: true },
      ],
    },
    {
      id: 'hydrosphere',
      title: 'HYDROSPHERE',
      fields: [
        { key: 'liquid_distribution', label: 'Liquid Distribution', hint: 'Water, methane, ammonia, etc.' },
        { key: 'cryosphere', label: 'Cryosphere', hint: 'Ice distribution.' },
        { key: 'hydrological_cycle', label: 'Hydrological Cycle', hint: 'Volatile cycles.', multiline: true },
      ],
    },
    {
      id: 'magnetosphere',
      title: 'MAGNETOSPHERE',
      fields: [
        { key: 'magnetic_field', label: 'Magnetic Field', hint: 'Strength and origin.' },
        { key: 'radiation_shielding', label: 'Radiation Shielding', hint: 'Protection.' },
        { key: 'auroral_activity', label: 'Auroral Activity', hint: 'If present.' },
      ],
    },
    {
      id: 'geology',
      title: 'SURFACE GEOLOGY',
      fields: [
        {
          key: 'dominant_terrain',
          label: 'Dominant Terrain',
          hint: 'Main planetary landscapes.',
          examples: ['Global ammonia ocean', 'Basaltic volcanic highlands', 'Silicate deserts'],
        },
        {
          key: 'major_surface_features',
          label: 'Major Surface Features',
          hint: 'Continents, oceans, basins, mountain ranges, lava plains, glaciers, etc.',
          multiline: true,
        },
        { key: 'surface_composition', label: 'Surface Composition', hint: 'Dominant minerals and materials.' },
        {
          key: 'hydrological_system',
          label: 'Hydrological System',
          hint: 'Water, methane, ammonia, hydrocarbons, molten rock, etc.',
        },
        { key: 'surface_coloration', label: 'Surface Coloration', hint: 'Scientifically justified dominant colors.', multiline: true },
      ],
    },
    {
      id: 'climate',
      title: 'CLIMATE',
      fields: [
        { key: 'global_climate', label: 'Global Climate', hint: 'Overall classification.' },
        { key: 'temperature_range', label: 'Temperature Range', hint: 'Average and extremes.' },
        { key: 'seasonality', label: 'Seasonality', hint: 'Seasonal behavior.' },
        { key: 'climate_drivers', label: 'Climate Drivers', hint: 'Primary physical mechanisms.', multiline: true },
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
            "Cause-and-effect explanation describing how the planet's observed properties emerge from its formation history, stellar environment and internal evolution.",
          multiline: true,
        },
      ],
    },
  ],
  promptTail: `LAYOUT
Premium AAA planetary science department presentation board.
Dark neutral background.
Editorial composition.
Asymmetrical layout.
Include:
• Planet profile
• Physical parameters
• Orbital diagram
• Geological cutaway
• Atmospheric diagram
• Surface material studies
• Global terrain map
• Climate overview
• Astronomical context
• Scientific callouts

VISUAL REFERENCE
Planet from Orbit
Surface View
Cross Section
Pole View
Equator View
Major Terrain Types
Scale Comparison

SCIENTIFIC CALLOUTS
Professional annotations explaining:
• planetary formation
• geological evolution
• atmospheric processes
• climate mechanisms
• orbital dynamics
• habitability constraints

CONSISTENCY RULE
The following properties must remain fixed across future generations:
• planetary mass
• radius
• gravity
• orbital parameters
• atmosphere
• geology
• climate
• magnetic field
• planetary history
Only natural temporal evolution is permitted.

OUTPUT
Production-grade planetary reference sheet suitable for:
• AI image generation
• AI video generation
• Scientific world building
• Documentary production
• AAA film production`,
}
