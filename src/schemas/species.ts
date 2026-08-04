import type { CardSchema } from './types'

/** Transcribed from "3- SPECIES AGENT MASTER PROMPT.docx". */
export const speciesSchema: CardSchema = {
  type: 'species',
  label: 'Tür',
  parent: 'ecosystem',
  directive: `Create a premium AAA species identity sheet for a recurring ultra-photorealistic fictional organism, used for maintaining absolute biological, evolutionary and visual consistency across AI-generated images and videos.

CORE DIRECTIVE
This is NOT concept art.
This is NOT fantasy creature design.
This is a professional biological reference sheet documenting a physically plausible organism exactly as it exists within its native ecosystem.
Everything must obey physics, ecology and evolution.
Every anatomical, physiological and behavioral characteristic must emerge naturally from the organism's environment and evolutionary history.
No arbitrary features.
No unexplained biological structures.
Every observable characteristic must have a functional and evolutionary explanation.`,
  inheritedKeys: [
    'species_name',
    'body_size',
    'body_plan',
    'habitat',
    'overall_body_structure',
    'external_covering',
    'locomotion_structures',
    'sensory_organs',
    'activity_pattern',
    'social_organization',
    'foraging_strategy',
    'defensive_behavior',
    'ecological_niche',
  ],
  sections: [
    {
      id: 'identity',
      title: 'SPECIES IDENTITY',
      fields: [
        { key: 'species_name', label: 'Species Name', hint: 'Official scientific/common name.' },
        {
          key: 'taxonomic_role',
          label: 'Taxonomic Role',
          hint: 'Producer, Consumer, Apex Predator, Decomposer, Parasite, Symbiont, etc.',
        },
        { key: 'ecological_role', label: 'Ecological Role', hint: 'Primary ecological function.' },
        { key: 'estimated_lifespan', label: 'Estimated Lifespan', hint: 'Average lifespan.' },
        { key: 'body_size', label: 'Body Size', hint: 'Length, height, mass.' },
        { key: 'body_symmetry', label: 'Body Symmetry', hint: 'Bilateral, radial, asymmetrical, etc.' },
        {
          key: 'body_plan',
          label: 'Body Plan',
          hint: 'General structural organization.',
          examples: [
            'Six-limbed armored grazer',
            'Floating colonial filter feeder',
            'Burrowing segmented omnivore',
          ],
        },
      ],
    },
    {
      id: 'ecological_context',
      title: 'ECOLOGICAL CONTEXT',
      fields: [
        { key: 'ecosystem', label: 'Ecosystem', hint: 'Inherited from Ecosystem Card.' },
        { key: 'habitat', label: 'Habitat', hint: 'Specific habitat.' },
        { key: 'trophic_level', label: 'Trophic Level', hint: 'Ecological position.' },
        { key: 'primary_food_source', label: 'Primary Food Source', hint: 'Energy acquisition.' },
        { key: 'predators', label: 'Predators', hint: 'Primary threats.' },
        { key: 'prey', label: 'Prey', hint: 'If applicable.' },
        { key: 'competitors', label: 'Competitors', hint: 'Ecological competitors.' },
        { key: 'symbiotic_relationships', label: 'Symbiotic Relationships', hint: 'If applicable.', multiline: true },
        { key: 'ecological_niche', label: 'Ecological Niche', hint: 'Functional niche.', multiline: true },
      ],
    },
    {
      id: 'anatomy',
      title: 'ANATOMY',
      fields: [
        { key: 'overall_body_structure', label: 'Overall Body Structure', hint: 'General morphology.', multiline: true },
        { key: 'support_system', label: 'Support System', hint: 'Endoskeleton, exoskeleton, hydrostatic, etc.' },
        { key: 'external_covering', label: 'External Covering', hint: 'Skin, scales, mineral shell, etc.', multiline: true },
        { key: 'locomotion_structures', label: 'Locomotion Structures', hint: 'Legs, fins, wings, cilia, etc.', multiline: true },
        { key: 'feeding_structures', label: 'Feeding Structures', hint: 'Mouthparts or equivalent.', multiline: true },
        { key: 'respiratory_structures', label: 'Respiratory Structures', hint: 'Gas exchange system.', multiline: true },
        { key: 'sensory_organs', label: 'Sensory Organs', hint: 'Primary sensory systems.', multiline: true },
        { key: 'defensive_structures', label: 'Defensive Structures', hint: 'Armor, camouflage, toxins, etc.', multiline: true },
        { key: 'internal_organization', label: 'Internal Organization', hint: 'Major organ systems.', multiline: true },
      ],
    },
    {
      id: 'physiology',
      title: 'PHYSIOLOGY',
      fields: [
        { key: 'metabolism', label: 'Metabolism', hint: 'Primary metabolic strategy.', multiline: true },
        { key: 'energy_source', label: 'Energy Source', hint: 'Photosynthetic, chemosynthetic, heterotrophic, etc.' },
        { key: 'internal_transport', label: 'Internal Transport', hint: 'Circulatory equivalent.' },
        { key: 'thermoregulation', label: 'Thermoregulation', hint: 'Temperature regulation.' },
        { key: 'waste_removal', label: 'Waste Removal', hint: 'Excretion.' },
        { key: 'growth_pattern', label: 'Growth Pattern', hint: 'Continuous, molting, determinate, etc.' },
        { key: 'repair_mechanisms', label: 'Repair Mechanisms', hint: 'Healing and regeneration.' },
      ],
    },
    {
      id: 'behavior',
      title: 'BEHAVIOR',
      fields: [
        { key: 'activity_pattern', label: 'Activity Pattern', hint: 'Diurnal, nocturnal, cyclic, etc.' },
        { key: 'social_organization', label: 'Social Organization', hint: 'Solitary, colonial, herd, etc.' },
        { key: 'communication', label: 'Communication', hint: 'Chemical, acoustic, electrical, visual, etc.' },
        { key: 'foraging_strategy', label: 'Foraging Strategy', hint: 'Primary feeding behavior.', multiline: true },
        { key: 'defensive_behavior', label: 'Defensive Behavior', hint: 'Escape, camouflage, aggression, etc.', multiline: true },
        { key: 'reproductive_behavior', label: 'Reproductive Behavior', hint: 'General strategy.', multiline: true },
        { key: 'migration', label: 'Migration', hint: 'If applicable.' },
      ],
    },
    {
      id: 'reproduction',
      title: 'REPRODUCTION',
      fields: [
        { key: 'reproductive_strategy', label: 'Reproductive Strategy', hint: 'Sexual, asexual, colonial, etc.' },
        { key: 'development', label: 'Development', hint: 'Embryonic, larval, metamorphic, etc.' },
        { key: 'parental_investment', label: 'Parental Investment', hint: 'None, partial, extensive.' },
        { key: 'generation_time', label: 'Generation Time', hint: 'Approximate.' },
      ],
    },
    {
      id: 'evolution',
      title: 'EVOLUTIONARY JUSTIFICATION',
      fields: [
        {
          key: 'evolutionary_origin',
          label: 'Evolutionary Origin',
          hint: 'What ancestral life form did this species evolve from?',
          examples: [
            'Chemosynthetic microbial reef colonies',
            'Burrowing mineral-feeding multicellular organisms',
          ],
          multiline: true,
        },
        {
          key: 'selection_pressures',
          label: 'Selection Pressures',
          hint: 'Primary environmental pressures responsible for shaping this species.',
          examples: ['High gravity', 'Intense radiation', 'Resource scarcity'],
          multiline: true,
        },
        {
          key: 'adaptive_advantages',
          label: 'Adaptive Advantages',
          hint: 'Functional advantages of each major adaptation.',
          examples: [
            'Dense mineralized skeleton increases structural stability',
            'Multi-spectrum vision improves detection under variable stellar illumination',
          ],
          multiline: true,
        },
        {
          key: 'evolutionary_tradeoffs',
          label: 'Evolutionary Trade-offs',
          hint: 'Costs associated with these adaptations.',
          examples: ['Heavy armor reduces mobility', 'High metabolic demand increases food dependency'],
          multiline: true,
        },
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
            "Cause-and-effect explanation describing how the organism's anatomy, physiology and behavior emerge directly from the planet's physical conditions, ecosystem structure and evolutionary history.",
          multiline: true,
        },
      ],
    },
  ],
  promptTail: `LAYOUT
Premium AAA biological research presentation board.
Dark neutral background.
Editorial composition.
Asymmetrical layout.
Include:
Full-body orthographic views
Anatomical cutaway
Skeletal/support structure
Internal anatomy
Sensory systems
Habitat placement
Scale comparison
Evolutionary diagram
Behavioral sequence
Scientific annotations

VISUAL REFERENCE
Full Body
Front View
Side View
Rear View
Top View
Anatomical Cutaway
Support Structure
Habitat Scale Comparison
Behavioral Pose
Close-up Details

SCIENTIFIC CALLOUTS
Professional annotations explaining:
anatomy
physiology
biomechanics
metabolism
ecological role
evolutionary history
adaptive strategies
environmental constraints

CONSISTENCY RULE
The following properties must remain fixed across future generations:
anatomy
physiology
biomechanics
metabolism
ecological niche
behavioral strategies
reproductive strategy
evolutionary history
adaptive characteristics
Only natural evolutionary change is permitted.

OUTPUT
Production-grade biological reference sheet suitable for:
AI image generation
AI video generation
Scientific world building
Documentary production
AAA film production`,
}
