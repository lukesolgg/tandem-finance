/**
 * Default categories and UK/IE merchant knowledge.
 *
 * Categories have stable `key`s so seed rules survive user renames. Groups
 * carry a `kind` that drives cash-flow maths: transfers never count as spend.
 */

export type GroupKind = "expense" | "income" | "transfer";

export interface SeedGroup {
  name: string;
  kind: GroupKind;
  categories: { key: string; name: string; emoji: string }[];
}

export const SEED_GROUPS: SeedGroup[] = [
  {
    name: "Bills",
    kind: "expense",
    categories: [
      { key: "housing", name: "Rent & mortgage", emoji: "🏠" },
      { key: "energy", name: "Energy", emoji: "⚡" },
      { key: "water", name: "Water", emoji: "🚰" },
      { key: "council_tax", name: "Council tax & rates", emoji: "🏛️" },
      { key: "phone_internet", name: "Phone & internet", emoji: "📶" },
      { key: "insurance", name: "Insurance", emoji: "🛡️" },
      { key: "subscriptions", name: "Subscriptions", emoji: "📺" },
      { key: "debt_repayment", name: "Loans & credit cards", emoji: "💳" },
    ],
  },
  {
    name: "Needs",
    kind: "expense",
    categories: [
      { key: "groceries", name: "Groceries", emoji: "🛒" },
      { key: "transport", name: "Transport", emoji: "🚌" },
      { key: "fuel", name: "Fuel", emoji: "⛽" },
      { key: "health", name: "Health & pharmacy", emoji: "💊" },
      { key: "childcare", name: "Childcare", emoji: "🧸" },
      { key: "pets", name: "Pets", emoji: "🐾" },
      { key: "household", name: "Household & DIY", emoji: "🧰" },
    ],
  },
  {
    name: "Wants",
    kind: "expense",
    categories: [
      { key: "eating_out", name: "Eating out & coffee", emoji: "🍽️" },
      { key: "takeaway", name: "Takeaways", emoji: "🥡" },
      { key: "shopping", name: "Shopping", emoji: "🛍️" },
      { key: "entertainment", name: "Entertainment", emoji: "🎬" },
      { key: "holidays", name: "Holidays & travel", emoji: "✈️" },
      { key: "personal_care", name: "Personal care", emoji: "💇" },
      { key: "gifts", name: "Gifts", emoji: "🎁" },
      { key: "fitness", name: "Fitness", emoji: "🏋️" },
    ],
  },
  {
    name: "Other",
    kind: "expense",
    categories: [
      { key: "cash", name: "Cash", emoji: "💷" },
      { key: "fees", name: "Bank fees & interest", emoji: "🏦" },
      { key: "uncategorised", name: "Uncategorised", emoji: "❔" },
    ],
  },
  {
    name: "Income",
    kind: "income",
    categories: [
      { key: "salary", name: "Salary", emoji: "💼" },
      { key: "benefits", name: "Benefits & tax refunds", emoji: "🧾" },
      { key: "interest", name: "Interest", emoji: "📈" },
      { key: "refunds", name: "Refunds", emoji: "↩️" },
      { key: "other_income", name: "Other income", emoji: "➕" },
    ],
  },
  {
    name: "Transfers",
    kind: "transfer",
    categories: [
      { key: "transfer", name: "Between our accounts", emoji: "🔄" },
      { key: "savings_transfer", name: "To savings & goals", emoji: "🐷" },
      { key: "partner_transfer", name: "To / from partner", emoji: "💞" },
    ],
  },
];

/**
 * Merchant knowledge: canonical name + regex over the CLEANED+lower-cased
 * description + default category. Order matters: first match wins, so more
 * specific patterns (Uber Eats) precede general ones (Uber).
 */
export interface MerchantSeed {
  key: string;
  name: string;
  pattern: RegExp;
  category: string;
}

const m = (key: string, name: string, pattern: RegExp, category: string): MerchantSeed => ({ key, name, pattern, category });

export const SEED_MERCHANTS: MerchantSeed[] = [
  // Takeaway before transport (Uber Eats vs Uber)
  m("uber_eats", "Uber Eats", /\buber\s*\*?\s*eats\b/, "takeaway"),
  m("deliveroo", "Deliveroo", /\bdeliveroo\b/, "takeaway"),
  m("just_eat", "Just Eat", /\bjust\s*eat\b/, "takeaway"),
  m("dominos", "Domino's", /\bdomino'?s\b/, "takeaway"),

  // Groceries (UK + NI/IE)
  m("tesco", "Tesco", /\btesco\b(?!\s*mobile)(?!\s*bank)/, "groceries"),
  m("sainsburys", "Sainsbury's", /\bsainsbury'?s?\b/, "groceries"),
  m("asda", "Asda", /\basda\b/, "groceries"),
  m("morrisons", "Morrisons", /\bmorrisons?\b/, "groceries"),
  m("aldi", "Aldi", /\baldi\b/, "groceries"),
  m("lidl", "Lidl", /\blidl\b/, "groceries"),
  m("waitrose", "Waitrose", /\bwaitrose\b/, "groceries"),
  m("marks_and_spencer", "M&S", /\bm\s*&\s*s\b|\bmarks\s*&?\s*spencer\b/, "groceries"),
  m("coop", "Co-op", /\bco-?op\b/, "groceries"),
  m("iceland", "Iceland", /\biceland foods?\b|^iceland\b/, "groceries"),
  m("spar", "Spar", /\bspar\b/, "groceries"),
  m("centra", "Centra", /\bcentra\b/, "groceries"),
  m("supervalu", "SuperValu", /\bsupervalu\b/, "groceries"),
  m("dunnes", "Dunnes Stores", /\bdunnes\b/, "groceries"),
  m("ocado", "Ocado", /\bocado\b/, "groceries"),

  // Eating out
  m("pret", "Pret A Manger", /\bpret\b/, "eating_out"),
  m("costa", "Costa", /\bcosta\b/, "eating_out"),
  m("starbucks", "Starbucks", /\bstarbucks\b/, "eating_out"),
  m("caffe_nero", "Caffè Nero", /\bcaff?e\s*nero\b/, "eating_out"),
  m("greggs", "Greggs", /\bgreggs\b/, "eating_out"),
  m("mcdonalds", "McDonald's", /\bmc\s*donald'?s\b/, "eating_out"),
  m("kfc", "KFC", /\bkfc\b/, "eating_out"),
  m("nandos", "Nando's", /\bnando'?s\b/, "eating_out"),
  m("wetherspoon", "Wetherspoon", /\bwetherspoons?\b|\bjd wetherspoon\b/, "eating_out"),

  // Transport & fuel
  m("tfl", "TfL", /\btfl\b|transport for london/, "transport"),
  m("translink", "Translink", /\btranslink\b/, "transport"),
  m("trainline", "Trainline", /\btrainline\b/, "transport"),
  m("uber", "Uber", /\buber\b/, "transport"),
  m("bolt", "Bolt", /\bbolt\.eu\b|^bolt\b/, "transport"),
  m("shell", "Shell", /\bshell\b/, "fuel"),
  m("bp", "BP", /^bp\b|\bbp (?:connect|express)\b/, "fuel"),
  m("esso", "Esso", /\besso\b/, "fuel"),
  m("texaco", "Texaco", /\btexaco\b/, "fuel"),
  m("applegreen", "Applegreen", /\bapplegreen\b/, "fuel"),
  m("maxol", "Maxol", /\bmaxol\b/, "fuel"),
  m("circle_k", "Circle K", /\bcircle\s*k\b/, "fuel"),
  m("dvla", "DVLA", /\bdvla\b/, "transport"),

  // Subscriptions
  m("netflix", "Netflix", /\bnetflix\b/, "subscriptions"),
  m("spotify", "Spotify", /\bspotify\b/, "subscriptions"),
  m("disney_plus", "Disney+", /\bdisney\s*(?:plus|\+)/, "subscriptions"),
  m("amazon_prime", "Amazon Prime", /\bamazon prime\b|\bprime video\b|\bamzn prime\b/, "subscriptions"),
  m("apple_services", "Apple", /\bapple\.com\/bill\b|\bitunes\b/, "subscriptions"),
  m("google_services", "Google", /\bgoogle\s*(?:\*|play|storage|one)\b/, "subscriptions"),
  m("youtube", "YouTube Premium", /\byoutube\b/, "subscriptions"),
  m("now_tv", "NOW", /\bnow\s*tv\b/, "subscriptions"),

  // Bills
  m("british_gas", "British Gas", /\bbritish gas\b/, "energy"),
  m("octopus", "Octopus Energy", /\boctopus energy\b/, "energy"),
  m("edf", "EDF", /\bedf\b/, "energy"),
  m("eon", "E.ON", /\be\.?on\b(?! the)/, "energy"),
  m("ovo", "OVO", /\bovo\b/, "energy"),
  m("nie", "NIE Energy", /\bnie\b|\bnie energy\b/, "energy"),
  m("power_ni", "Power NI", /\bpower ni\b/, "energy"),
  m("sse_airtricity", "SSE Airtricity", /\bairtricity\b/, "energy"),
  m("firmus", "Firmus", /\bfirmus\b/, "energy"),
  m("budget_energy", "Budget Energy", /\bbudget energy\b/, "energy"),
  m("thames_water", "Thames Water", /\bthames water\b/, "water"),
  m("council_tax", "Council tax", /\bcouncil tax\b|\bcouncil\b.*\bctax\b/, "council_tax"),
  m("lps_rates", "LPS Rates", /\blps\b|\bland (?:&|and) property services\b/, "council_tax"),
  m("ee", "EE", /^ee\b|\bee limited\b/, "phone_internet"),
  m("vodafone", "Vodafone", /\bvodafone\b/, "phone_internet"),
  m("o2", "O2", /\bo2\b|\btelefonica\b/, "phone_internet"),
  m("three", "Three", /\bthree\.co\.uk\b|\bhutchison\b/, "phone_internet"),
  m("giffgaff", "giffgaff", /\bgiffgaff\b/, "phone_internet"),
  m("bt", "BT", /^bt\b|\bbt group\b/, "phone_internet"),
  m("sky", "Sky", /\bsky\b/, "phone_internet"),
  m("virgin_media", "Virgin Media", /\bvirgin media\b/, "phone_internet"),
  m("tv_licence", "TV Licence", /\btv licen[cs]e\b/, "subscriptions"),

  // Shopping & household
  m("amazon", "Amazon", /\bamazon\b|\bamzn\b/, "shopping"),
  m("argos", "Argos", /\bargos\b/, "shopping"),
  m("ebay", "eBay", /\bebay\b/, "shopping"),
  m("asos", "ASOS", /\basos\b/, "shopping"),
  m("primark", "Primark", /\bprimark\b/, "shopping"),
  m("next", "Next", /^next\b/, "shopping"),
  m("ikea", "IKEA", /\bikea\b/, "household"),
  m("b_and_q", "B&Q", /\bb\s*&\s*q\b/, "household"),
  m("screwfix", "Screwfix", /\bscrewfix\b/, "household"),
  m("boots", "Boots", /\bboots\b/, "health"),
  m("superdrug", "Superdrug", /\bsuperdrug\b/, "personal_care"),
  m("puregym", "PureGym", /\bpure\s*gym\b/, "fitness"),
  m("odeon", "Odeon", /\bodeon\b/, "entertainment"),
  m("cineworld", "Cineworld", /\bcineworld\b/, "entertainment"),
  m("vue", "Vue", /^vue\b|\bvue cinema/, "entertainment"),
  m("steam", "Steam", /\bsteam(?:games| purchase|powered)?\b/, "entertainment"),
  m("playstation", "PlayStation", /\bplaystation\b|\bsony interactive\b/, "entertainment"),
  m("xbox", "Xbox", /\bxbox\b|\bmicrosoft\*xbox/, "entertainment"),
  m("ticketmaster", "Ticketmaster", /\bticketmaster\b/, "entertainment"),

  // Travel
  m("ryanair", "Ryanair", /\bryanair\b/, "holidays"),
  m("easyjet", "easyJet", /\beasyjet\b/, "holidays"),
  m("british_airways", "British Airways", /\bbritish airways\b/, "holidays"),
  m("airbnb", "Airbnb", /\bairbnb\b/, "holidays"),
  m("booking_com", "Booking.com", /\bbooking\.com\b/, "holidays"),

  // Income
  m("hmrc", "HMRC", /\bhmrc\b/, "benefits"),
  m("dwp", "DWP", /\bdwp\b/, "benefits"),
];

/** Monzo/Starling put their own category on each row. Use as a weak prior. */
export const BANK_CATEGORY_MAP: Record<string, string> = {
  groceries: "groceries",
  "eating out": "eating_out",
  eating_out: "eating_out",
  transport: "transport",
  bills: "energy",
  bills_and_services: "energy",
  entertainment: "entertainment",
  shopping: "shopping",
  holidays: "holidays",
  "personal care": "personal_care",
  general: "uncategorised",
  income: "other_income",
  savings: "savings_transfer",
  gifts: "gifts",
  charity: "gifts",
  family: "childcare",
  "travel-airline": "holidays",
};
