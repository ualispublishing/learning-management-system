/**
 * @fileoverview src/lib/db/demo_seed_legacy.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { DeckStore, EditorStore } from './store';
import { Deck } from '../../types';

export async function seedDemoData() {
  if (process.env.NODE_ENV === 'production') return;
  const allDecks = await DeckStore.getAll();
  const existingDeckIds = new Set(allDecks.map(deck => deck.id));

  const decksData = [
    {
      deck: { id: 'deck_spanish', name: 'Spanish Vocabulary', description: 'Core words with semantic depth' },
      cards: [
        { front: 'El perro', layers: ['Translation: The dog (Basic noun)', 'Grammar: Masculine noun. Plural: Los perros', "Nuance: Idiom 'Estar de un humor de perros' means to be in a very bad mood.", 'Application: Mi perro es muy inteligente y le encanta jugar en el parque.'] },
        { front: 'La casa', layers: ['Translation: The house / The home', 'Grammar: Feminine noun. Plural: Las casas', 'Nuance: Can refer to the physical building or the emotional concept of home. Related: Casero (Homemade).', 'Application: Voy a mi casa ahora porque estoy cansado.'] },
        { front: 'El gato', layers: ['Translation: The cat', 'Grammar: Masculine noun. Plural: Los gatos. (Feminine: La gata)', "Nuance: Idiom 'Dar gato por liebre' means to deceive or trick someone.", 'Application: El gato duerme plácidamente en la silla todo el día.'] },
        { front: 'El libro', layers: ['Translation: The book', 'Grammar: Masculine noun. Plural: Los libros', "Nuance: Watch out for false friends! 'Librería' means bookstore, whereas library is 'Biblioteca'.", 'Application: Me gusta leer un buen libro antes de dormir.'] },
        { front: 'El agua', layers: ['Translation: The water', 'Grammar: Feminine noun, but uses "el" in singular (El agua) to avoid double "a" sound. Plural: Las aguas.', "Nuance: Idiom 'Estar con el agua al cuello' means to be in a very difficult or stressful situation.", 'Application: Es fundamental beber mucha agua cada día para la salud.'] },
      ]
    },
    {
      deck: { id: 'deck_history', name: 'World History', description: 'Key historical events' },
      cards: [
        { front: 'Fall of Western Roman Empire', layers: ['Basic: Occurred in 476 AD, marking the end of Roman rule in Western Europe.', 'Key Detail: Odoacer deposed Emperor Romulus Augustulus, the final Western Roman Emperor.', 'Broader Impact: Historically marks the pivotal transition from Antiquity to the Middle Ages in Europe.', 'Nuance/Synthesis: Resulted from a complex mix of barbarian invasions, economic decline, and military overspending.'] },
        { front: 'French Revolution', layers: ['Basic: Began in 1789 with the storming of the Bastille.', 'Key Detail: Driven by severe social inequality, economic crisis, and Enlightenment ideals.', 'Broader Impact: Led to the violent abolition of the absolute monarchy and the rise of radical groups.', 'Nuance/Synthesis: Ultimately paved the way for Napoleon Bonaparte and transformed modern political ideologies worldwide.'] },
        { front: 'Industrial Revolution', layers: ['Basic: Started around 1760 in Britain, marking a transition to new manufacturing processes.', 'Key Detail: Driven by transformative inventions like the steam engine and spinning jenny.', 'Broader Impact: Profoundly altered social structures, rapidly urbanizing previously rural populations.', 'Nuance/Synthesis: Led to long-term global economic shifts, the birth of labor rights movements, and lasting environmental impacts.'] },
        { front: 'Moon Landing', layers: ['Basic: On July 20, 1969, the Apollo 11 mission successfully landed on the moon.', 'Key Detail: Neil Armstrong and Buzz Aldrin became the first humans to walk on the lunar surface.', 'Broader Impact: Served as a major ideological and technological victory for the US in the Cold War Space Race.', 'Nuance/Synthesis: Vastly advanced aerospace technology and permanently altered humanity\'s perspective of its place in the universe.'] },
        { front: 'Magna Carta', layers: ['Basic: A royal charter of rights agreed to by King John of England in 1215.', 'Key Detail: Established the revolutionary principle that everyone, including the king, is subject to the law.', 'Broader Impact: Though initially a failed peace treaty, it was reissued and became a symbol of liberty.', 'Nuance/Synthesis: Served as a foundational document for modern democratic and constitutional principles worldwide.'] },
      ]
    },
    {
      deck: { id: 'deck_chemistry', name: 'Chemistry', description: 'Core chemical principles' },
      cards: [
        { front: 'H2O', layers: ['Basic: Water, a molecule composed of 2 Hydrogen atoms and 1 Oxygen atom.', 'Structure: Features polar covalent bonds, resulting in a bent molecular shape.', 'Properties: Known as the "universal solvent" due to its polarity and hydrogen bonding capabilities.', 'Application/Nuance: Its anomalous expansion upon freezing allows ice to float, which is vital for aquatic life survival.'] },
        { front: 'NaCl', layers: ['Basic: Sodium Chloride, commonly known as Table Salt.', 'Structure: Formed by an ionic bond between a Sodium cation (Na+) and a Chloride anion (Cl-).', 'Properties: Exists as a highly stable, crystalline lattice structure at room temperature.', 'Application/Nuance: Essential for biology, playing a critical role in nerve impulse transmission and muscle contractions.'] },
        { front: 'C6H12O6', layers: ['Basic: Glucose, a simple sugar (monosaccharide).', 'Origin: Produced by plants during photosynthesis using sunlight, water, and carbon dioxide.', 'Function: Serves as the primary source of energy for cellular respiration in most living organisms.', 'Application/Nuance: Imbalances in its metabolism and cellular uptake are the central mechanism behind diabetes mellitus.'] },
        { front: 'Noble Gases', layers: ['Basic: The elements located in Group 18 of the periodic table (e.g., Helium, Neon, Argon).', 'Structure: Characterized by having completely full valence electron shells, making them highly stable.', 'Properties: Chemically unreactive (inert) under standard conditions due to their optimal electron configuration.', 'Application/Nuance: Used in applications requiring a non-reactive environment, such as neon lighting or shielding gas in arc welding.'] },
        { front: 'Covalent Bond', layers: ['Basic: A chemical bond formed by the sharing of electron pairs between atoms.', 'Formation: Typically occurs between non-metal atoms with similar electronegativities.', 'Properties: Can be polar (unequal sharing) or non-polar (equal sharing), which strongly dictates molecular properties.', 'Application/Nuance: Responsible for the formation of highly stable, complex molecules, including all organic compounds in biology.'] },
      ]
    },
    {
      deck: { id: 'deck_technology', name: 'Technology', description: 'Fundamental computing concepts' },
      cards: [
        { front: 'CPU', layers: ['Basic: Central Processing Unit, the primary component of a computer that acts as its "brain".', 'Architecture: Consists of the ALU (Arithmetic Logic Unit), Control Unit, and Registers.', 'Operation: Executes instructions via the fetch-decode-execute cycle.', 'Application/Nuance: Modern CPUs have multiple cores, allowing parallel execution of threads to improve performance.'] },
        { front: 'RAM', layers: ['Basic: Random Access Memory, a type of volatile memory used for short-term data storage.', 'Structure: Composed of microscopic capacitors and transistors that store bits of data.', 'Properties: Volatile, meaning it loses all stored information when power is removed.', 'Application/Nuance: Faster than storage drives (SSD/HDD) but significantly more expensive per gigabyte.'] },
        { front: 'API', layers: ['Basic: Application Programming Interface, a set of rules that allows different software entities to communicate.', 'Structure: Typically consists of endpoints, request methods (GET, POST), and expected data formats.', 'Function: Abstracts complex logic, allowing developers to use external services without knowing their internal workings.', 'Application/Nuance: REST and GraphQL are dominant paradigms for web APIs, dictating how data is requested and shaped.'] },
        { front: 'IP Address', layers: ['Basic: Internet Protocol Address, a unique numerical label assigned to devices on a computer network.', 'Structure: IPv4 uses 32-bit addresses (e.g., 192.168.1.1), while IPv6 uses 128-bit addresses.', 'Function: Enables precise routing of data packets across the internet by providing a source and destination.', 'Application/Nuance: Can be dynamic (changing) or static (fixed), and is often masked by a VPN for privacy.'] },
        { front: 'Encryption', layers: ['Basic: The process of converting plain text into a scrambled ciphertext to prevent unauthorized access.', 'Methods: Symmetric (same key for encryption and decryption) and Asymmetric (public and private key pair).', 'Function: Secures data at rest (stored) and data in transit (moving across networks).', 'Application/Nuance: Fundamental to internet security (HTTPS/SSL), though future quantum computers threaten current RSA standards.'] },
      ]
    }
  ];

  for (let i = 0; i < decksData.length; i++) {
    const data = decksData[i];
    if (existingDeckIds.has(data.deck.id)) continue;
    const deck: Deck = {
      id: data.deck.id,
      user_id: 'user_1',
      name: data.deck.name,
      description: data.deck.description,
      settings: {},
      position: i,
      completed_once: false,
      created_at: Date.now()
    };
    await DeckStore.insert(deck);

    // To ensure the demo has a good mix of cards with different levels of semantic depth unlocked,
    // we will systematically vary the initialUnlockedLayers from 1 to 4.
    let depthCounter = 1;

    for (const cardData of data.cards) {
      await EditorStore.createCardWithLayers(deck.id, cardData.front, cardData.layers, depthCounter);
      
      // Cycle depth from 1 to 4
      depthCounter = depthCounter >= 4 ? 1 : depthCounter + 1;
    }
  }
}
