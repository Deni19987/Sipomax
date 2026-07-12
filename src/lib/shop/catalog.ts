// Sipomax produktkatalog.
//
// Produkterna är hämtade från sipomax.se (WooCommerce-butiken) och indelade i
// kategorier som speglar sajtens struktur. OBS: priserna är platshållare —
// sipomax.se kunde inte nås direkt från byggmiljön, så priserna behöver
// stämmas av mot Fortnox/butiken innan lansering. `articleNumber` är tänkt att
// mappas mot Fortnox artikelnummer vid fakturering.

export type CategoryId =
  | "tvatt"
  | "rengoring"
  | "polering"
  | "skydd"
  | "interior"
  | "tillbehor"
  | "maskiner";

export interface Category {
  id: CategoryId;
  name: string;
  description: string;
  /** Tailwind gradient som används som kortbakgrund tills riktiga foton finns. */
  gradient: string;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: CategoryId;
  description: string;
  /** Pris i SEK exkl. moms. Platshållare tills de stäms av mot Fortnox. */
  price: number;
  /** T.ex. "5 L", "500 ml", "styck" */
  unit: string;
  articleNumber?: string;
  popular?: boolean;
}

export const FREE_SHIPPING_THRESHOLD = 2500; // kr exkl. moms, enligt sipomax.se

export const CATEGORIES: Category[] = [
  {
    id: "tvatt",
    name: "Tvätt",
    description: "Schampo, avfettning och förtvättsmedel som löser trafikfilm, salt och vägsmuts.",
    gradient: "from-slate-700 via-slate-800 to-slate-950",
  },
  {
    id: "rengoring",
    name: "Rengöring",
    description: "Fälgmedel, insektsborttagare och specialrengöring för alla ytor.",
    gradient: "from-sky-800 via-slate-800 to-slate-950",
  },
  {
    id: "polering",
    name: "Polering",
    description: "Polermedel, polermaskiner och polertrissor från Rupes och Malco.",
    gradient: "from-amber-700 via-stone-800 to-stone-950",
  },
  {
    id: "skydd",
    name: "Skydd",
    description: "Keramiska lackskydd, vax och långtidsskydd för lack, glas och fälgar.",
    gradient: "from-zinc-700 via-zinc-800 to-black",
  },
  {
    id: "interior",
    name: "Interiör",
    description: "Läder-, textil- och plastvård för en fräsch kupé.",
    gradient: "from-stone-600 via-stone-800 to-stone-950",
  },
  {
    id: "tillbehor",
    name: "Tillbehör",
    description: "Mikrofiber, svampar, hinkar, skrapor och trycksprutor.",
    gradient: "from-emerald-800 via-slate-800 to-slate-950",
  },
  {
    id: "maskiner",
    name: "Maskiner & Utrustning",
    description: "Högtryckstvättar, dammsugare, klädseltvättar och kemsprutor för proffs.",
    gradient: "from-red-800 via-slate-900 to-black",
  },
];

export const PRODUCTS: Product[] = [
  // ── Tvätt ────────────────────────────────────────────────────────────────
  {
    id: "sipom-giove-skumschampo",
    name: "Sipom GIOVE Skumschampo",
    brand: "Sipom",
    category: "tvatt",
    description:
      "Högkvalitativt skumschampo med hög skumbildning som löser smuts, smog och fett. Naturligt pH-värde — säkert på alla ytor.",
    price: 395,
    unit: "5 L",
    popular: true,
  },
  {
    id: "sipom-power-plus-s-alkalisk-avfettning",
    name: "Sipom POWER PLUS/S Alkalisk avfettning",
    brand: "Sipom",
    category: "tvatt",
    description:
      "Kraftfull alkalisk avfettning som effektivt löser tuff smuts, fett, olja och andra föroreningar från fordon och industriella ytor.",
    price: 445,
    unit: "5 L",
    popular: true,
  },
  {
    id: "sipom-luxor-avfettning",
    name: "Sipom LUXOR Avfettning",
    brand: "Sipom",
    category: "tvatt",
    description:
      "Mycket effektiv avfettning som enkelt löser och tar bort svår smuts, fett och oljeföroreningar från fordon och andra ytor.",
    price: 425,
    unit: "5 L",
  },
  {
    id: "kallavfettning-v46",
    name: "Kallavfettning V46",
    brand: "Sipomax",
    category: "tvatt",
    description:
      "Löser snabbt och effektivt asfaltsfläckar, tjärfläckar, dubbdäckssmuts och vägsalt. Används på torr yta före tvätt.",
    price: 365,
    unit: "5 L",
  },
  {
    id: "malco-cw37-car-truck-wash",
    name: "MALCO CW-37 Premium Car & Truck Wash",
    brand: "Malco",
    category: "tvatt",
    description:
      "Högpresterande tvättkoncentrat speciellt framtaget för att effektivt och skonsamt rengöra personbilar och lastbilar.",
    price: 495,
    unit: "3,8 L",
  },

  // ── Rengöring ────────────────────────────────────────────────────────────
  {
    id: "malco-complete-wheel-tire-cleaner",
    name: "MALCO Complete Wheel & Tire Cleaner",
    brand: "Malco",
    category: "rengoring",
    description:
      "Syrafri formula som effektivt tar bort envis smuts, bromsdamm och beläggningar från både fälgar och däck.",
    price: 385,
    unit: "3,8 L",
    popular: true,
  },
  {
    id: "bug-off-insect-remover",
    name: "Bug-Off Insect Remover",
    brand: "Sipomax",
    category: "rengoring",
    description:
      "Tar enkelt och effektivt bort envisa insekter från fordonets ytor. Säker på lack, glas, metall och plast.",
    price: 195,
    unit: "1 L",
  },
  {
    id: "sipom-moscerini-insektsborttagare",
    name: "Sipom MOSCERINI Insektsborttagare",
    brand: "Sipom",
    category: "rengoring",
    description:
      "Specialiserad insektsborttagare för alla exteriöra ytor — lack, plast, glas och krom — utan att skada eller lämna märken.",
    price: 345,
    unit: "5 L",
  },
  {
    id: "oxy-carpet-upholstery-cleaner",
    name: "Oxy Carpet & Upholstery Cleaner",
    brand: "Malco",
    category: "rengoring",
    description:
      "Syrebaserad textilrengöring som löser smuts, kaffe, fett och vardagsfläckar ur säten, mattor och innertak.",
    price: 265,
    unit: "650 ml",
  },
  {
    id: "sipom-plastica-flower-fresh",
    name: "Sipom Plastica Flower Fresh",
    brand: "Sipom",
    category: "rengoring",
    description:
      "Rengöringsmedel med lätt polerande effekt för plastdetaljer både invändigt och utvändigt. Fräsch blomdoft.",
    price: 315,
    unit: "5 L",
  },

  // ── Polering ─────────────────────────────────────────────────────────────
  {
    id: "rupes-lhr21iii-std-polermaskin",
    name: "Rupes LHR21III/STD Polermaskin",
    brand: "Rupes",
    category: "polering",
    description:
      "Oscillerande polermaskin i proffsklass med 21 mm slaglängd. Standardkit med trissor och polermedel.",
    price: 4995,
    unit: "styck",
    popular: true,
  },
  {
    id: "polermaskin-lhr21v-std-kit",
    name: "Rupes LHR21V Mark V Polermaskin STD-kit",
    brand: "Rupes",
    category: "polering",
    description:
      "Femte generationens oscillerande polermaskin, 150 mm. Ny polyfiber-drivteknik ger tystare och mjukare gång med förbättrad balans.",
    price: 5795,
    unit: "styck",
  },
  {
    id: "polermaskin-batteridriven-hlr21",
    name: "Rupes HLR21 Batteridriven Polermaskin",
    brand: "Rupes",
    category: "polering",
    description: "Batteridriven oscillerande polermaskin, 150 mm — full frihet utan sladd.",
    price: 7495,
    unit: "styck",
  },
  {
    id: "rupes-lhr75e-mini-polermaskin",
    name: "Rupes LHR75E Mini Polermaskin",
    brand: "Rupes",
    category: "polering",
    description: "Optimal maskin för små och medelstora polerjobb — detaljer, stötfångare och trånga ytor.",
    price: 3695,
    unit: "styck",
  },
  {
    id: "poleringspaket-rupes-lhr15iii",
    name: "Poleringspaket med Rupes LHR15III",
    brand: "Rupes",
    category: "polering",
    description: "Komplett startpaket för lackkorrigering: maskin, trissor och polermedel i ett kit.",
    price: 5495,
    unit: "paket",
  },
  {
    id: "rupes-ulltrissa-bla-160",
    name: "RUPES Ulltrissa Blå 160 mm",
    brand: "Rupes",
    category: "polering",
    description:
      "Avancerad ulltrissa (2024 års design, tillverkad i Italien). Optimerad för Rupes blå DA-grovpolermedel.",
    price: 245,
    unit: "styck",
  },
  {
    id: "malco-epic-purple-foamed-wool-pad",
    name: "MALCO EPIC Purple Foamed Wool Heavy Duty Pad 5,5\"",
    brand: "Malco",
    category: "polering",
    description: "Heavy duty-trissa i skummad ull för kraftfull lackkorrigering med hög finish.",
    price: 295,
    unit: "styck",
  },
  {
    id: "micro-hybrid-pad-80",
    name: "Micro Hybrid Pad 80",
    brand: "Sipomax",
    category: "polering",
    description: "Hybridtrissa i mikrofiber, 80 mm, för effektiv polering av mindre ytor.",
    price: 149,
    unit: "styck",
  },
  {
    id: "malco-rejuvenator-one-step",
    name: "MALCO Rejuvenator One-Step Paint Restoration",
    brand: "Malco",
    category: "polering",
    description:
      "Enstegspolish för lackkorrigering som snabbt återställer åldrad, oxiderad eller miljöskadad billack.",
    price: 545,
    unit: "946 ml",
    popular: true,
  },
  {
    id: "malco-metal-polish",
    name: "Malco Metal Polish",
    brand: "Malco",
    category: "polering",
    description:
      "Mikroslipande polish som tar bort ytoxidation, fläckar och små repor från krom, aluminium, rostfritt, mässing och koppar.",
    price: 225,
    unit: "473 ml",
  },
  {
    id: "poler-borste",
    name: "Polerborste",
    brand: "Sipomax",
    category: "polering",
    description: "Oumbärligt verktyg för att snabbt rengöra polertrissor och mikrofiberdukar.",
    price: 95,
    unit: "styck",
  },

  // ── Skydd ────────────────────────────────────────────────────────────────
  {
    id: "nasiol-neocoatx-keramiskt-lackskydd",
    name: "Nasiol NeoCoatX Keramiskt Lackskydd",
    brand: "Nasiol",
    category: "skydd",
    description: "Keramiskt lackskydd med extrem glans och hydrofoba egenskaper för långvarigt skydd.",
    price: 1295,
    unit: "50 ml",
    popular: true,
  },
  {
    id: "nasiol-zr53-langvarigt-skydd",
    name: "Nasiol ZR53 Långvarigt Skydd",
    brand: "Nasiol",
    category: "skydd",
    description: "Nanokeramisk coating som skyddar lacken i upp till 3 år mot UV, kemikalier och smuts.",
    price: 1495,
    unit: "50 ml",
  },
  {
    id: "nasiol-glasshield",
    name: "Nasiol GlasShield",
    brand: "Nasiol",
    category: "skydd",
    description: "Regnavvisande nanocoating för vindrutor och glas — bättre sikt i regn och enklare rengöring.",
    price: 495,
    unit: "150 ml",
  },
  {
    id: "nasiol-metalcoat-f2",
    name: "Nasiol MetalCoat F2 Sprayable Ceramic Coating",
    brand: "Nasiol",
    category: "skydd",
    description: "Spraybar keramisk coating som ger metallytor och lack djup glans och hydrofobt skydd.",
    price: 895,
    unit: "250 ml",
  },
  {
    id: "nasiol-nl272-nano-ceramic",
    name: "Nasiol NL272 Nano Ceramic Coating",
    brand: "Nasiol",
    category: "skydd",
    description: "Professionell nanokeramisk lackförsegling med extremt slitstark yta och hög glans.",
    price: 1695,
    unit: "50 ml",
  },
  {
    id: "epic-cr2-hydro-protect-ceramic-spray",
    name: "EPIC CR2 Hydro Protect Ceramic Spray",
    brand: "Malco",
    category: "skydd",
    description:
      "SiO2-baserad spray-on keramisk formula som ger hög glans, skydd och kraftigt vattenavvisande egenskaper.",
    price: 445,
    unit: "650 ml",
    popular: true,
  },
  {
    id: "malco-epic-ceramic-final-prep-wipe",
    name: "MALCO EPIC Ceramic Final Prep Wipe",
    brand: "Malco",
    category: "skydd",
    description: "Det avgörande sista steget före keramisk coating — avfettar och förbereder lackytan.",
    price: 345,
    unit: "946 ml",
  },
  {
    id: "sipom-brill-3-plastglans",
    name: "Sipom Brill 3 Plastglans",
    brand: "Sipom",
    category: "skydd",
    description: "Ger plast-, gummi- och vinylytor djup lyster och skydd. För både interiör och exteriör.",
    price: 365,
    unit: "5 L",
  },

  // ── Interiör ─────────────────────────────────────────────────────────────
  {
    id: "malco-leather-conditioner-945",
    name: "Malco Leather Conditioner",
    brand: "Malco",
    category: "interior",
    description:
      "Återfuktar och skyddar lädersäten mot uttorkning, sprickor och färgförlust. Lämnar en naturlig finish.",
    price: 295,
    unit: "945 ml",
    popular: true,
  },

  // ── Tillbehör ────────────────────────────────────────────────────────────
  {
    id: "microfiber-twist-drying-towel-50x70",
    name: "Microfiber TWIST Drying Towel 50×70",
    brand: "Sipomax",
    category: "tillbehor",
    description:
      "Torkduk med twist-loop-teknik som absorberar stora mängder vatten utan att lämna ränder på lack, glas och plast.",
    price: 149,
    unit: "styck",
    popular: true,
  },
  {
    id: "biltvattsvamp-gra",
    name: "Biltvättsvamp Grå",
    brand: "Sipomax",
    category: "tillbehor",
    description: "Mjuk och skonsam tvättsvamp för handtvätt av fordon.",
    price: 49,
    unit: "styck",
  },
  {
    id: "malco-tvatthink",
    name: "Malco Tvätthink",
    brand: "Malco",
    category: "tillbehor",
    description: "Robust tvätthink för professionell fordonstvätt.",
    price: 129,
    unit: "styck",
  },
  {
    id: "malco-matthallare",
    name: "Malco Matthållare",
    brand: "Malco",
    category: "tillbehor",
    description: "Håller bilmattor på plats vid tvätt och rekonditionering.",
    price: 195,
    unit: "styck",
  },
  {
    id: "vatskrapa-gron",
    name: "Våtskrapa Grön",
    brand: "Sipomax",
    category: "tillbehor",
    description: "Effektiv våtskrapa för snabb avtorkning av glas- och lackytor.",
    price: 79,
    unit: "styck",
  },
  {
    id: "munstycke-inkl-spridare-estro110",
    name: "Munstycke inkl. spridare Estro110",
    brand: "Sipomax",
    category: "tillbehor",
    description: "Reservmunstycke med spridare till Estro110-kemspruta.",
    price: 89,
    unit: "styck",
  },

  // ── Maskiner & Utrustning ────────────────────────────────────────────────
  {
    id: "pax-hogtryckstvatt-200bar",
    name: "PAX Högtryckstvätt 200 BAR",
    brand: "PAX",
    category: "maskiner",
    description:
      "Professionell högtryckstvätt på 200 bar för bilvård, verkstad, lantbruk och industri. Byggd för daglig drift.",
    price: 12995,
    unit: "styck",
    popular: true,
  },
  {
    id: "elsea-dammsugare-vat-torr-2motor",
    name: "ELSEA Dammsugare Våt & Torr 2-motor",
    brand: "ELSEA",
    category: "maskiner",
    description:
      "Professionell våt- och torrdammsugare med två motorer och kraftfull sugkapacitet för rekonditionering.",
    price: 5495,
    unit: "styck",
  },
  {
    id: "kladseltvatt-hetvatten",
    name: "Klädseltvätt Hetvatten",
    brand: "ELSEA",
    category: "maskiner",
    description: "Textiltvättmaskin med hetvatten för säten, golv och innertak — djuprengör klädsel snabbt.",
    price: 14995,
    unit: "styck",
  },
  {
    id: "varmluftgenerator-rekond-flakt",
    name: "Varmluftgenerator / Rekonditioneringsfläkt",
    brand: "Sipomax",
    category: "maskiner",
    description: "Kraftfull varmluftsfläkt som snabbt torkar kupéer och textilier efter rekonditionering.",
    price: 3495,
    unit: "styck",
  },
  {
    id: "bead-bazooka-invento-12l",
    name: "Bead Bazooka Chockluftare Invento 12 L",
    brand: "Bead Bazooka",
    category: "maskiner",
    description: "Chockluftare på 12 liter som sätter däck på fälg snabbt och säkert.",
    price: 4295,
    unit: "styck",
  },
];

export function getCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function productsByCategory(id: CategoryId): Product[] {
  return PRODUCTS.filter((p) => p.category === id);
}

export function searchProducts(query: string): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return PRODUCTS;
  return PRODUCTS.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      (getCategory(p.category)?.name.toLowerCase().includes(q) ?? false),
  );
}

export function formatPrice(price: number): string {
  return `${price.toLocaleString("sv-SE")} kr`;
}
