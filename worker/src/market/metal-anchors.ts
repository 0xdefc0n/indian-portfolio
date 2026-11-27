// Reference ETFs and IBJA anchors for the gold and silver rates (plan §21.5, M29). Public data, updated by hand with
// the PPF/EPF rate table each quarter (an M16 ops checklist item): add the latest RBI SGB redemption price and an
// IBJA silver close. The next nav-ingest run recomputes the history with them.
import type { Metal } from '../lib/metals'
import type { Ymd } from './amfi'

/** Large, long-lived ETFs (AMFI codes, NAVAll 26-Nov-2026). Their NAVs come with every nav-ingest run. */
export const METAL_REFS: readonly { metal: Metal; code: number; name: string }[] = [
  { metal: 'gold', code: 140088, name: 'Nippon India ETF Gold BeES' },
  { metal: 'gold', code: 113049, name: 'HDFC Gold ETF' },
  { metal: 'gold', code: 111954, name: 'SBI Gold ETF' },
  { metal: 'gold', code: 113076, name: 'ICICI Prudential Gold ETF' },
  { metal: 'gold', code: 106193, name: 'Kotak Gold ETF' },
  { metal: 'silver', code: 149758, name: 'Nippon India Silver ETF' },
  { metal: 'silver', code: 149464, name: 'ICICI Prudential Silver ETF' },
  { metal: 'silver', code: 149779, name: 'Aditya Birla Sun Life Silver ETF' },
  { metal: 'silver', code: 150556, name: 'HDFC Silver ETF' },
  { metal: 'silver', code: 150610, name: 'Axis Silver ETF' },
]

/** ₹ per gram of 999 metal, as the simple average of IBJA closes on `dates`. */
export type MetalAnchor = { dates: Ymd[]; price: number; source: string }

/**
 * Gold: RBI's SGB redemption prices, one a month (the month's last), January 2021 to November 2026. Each is the simple
 * average of IBJA 999 closes on the dates listed (three business days; the early tranches used the Monday–Friday
 * week before). All checked against the release's amount in words; those inside our IBJA sample reproduce exactly.
 * Silver: IBJA silver 999 PM closes (₹/kg ÷ 1000) from its published "Previous 30 Days" sheets, May 2025 to November
 * 2026 (five also matched news quotes). Checked 2026-11-27.
 */
export const METAL_ANCHORS: Record<Metal, readonly MetalAnchor[]> = {
  gold: [
    { dates: [20210201, 20210202, 20210203, 20210204, 20210205], price: 4796, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=51087' },
    { dates: [20210726, 20210727, 20210728, 20210729, 20210730], price: 4804, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=52002' },
    { dates: [20210920, 20210921, 20210922, 20210923, 20210924], price: 4652, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=52310' },
    { dates: [20211122, 20211123, 20211124, 20211125, 20211126], price: 4808, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=52638' },
    { dates: [20220124, 20220125, 20220126, 20220127, 20220128], price: 4852, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=53226' },
    { dates: [20220131, 20220201, 20220202, 20220203, 20220204], price: 4813, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=53234' },
    { dates: [20220321, 20220322, 20220323, 20220324, 20220325], price: 5166, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=53477' },
    { dates: [20220523, 20220524, 20220525, 20220526, 20220527], price: 5119, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=53777' },
    { dates: [20220725, 20220726, 20220727, 20220728, 20220729], price: 5104, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=54125' },
    { dates: [20220801, 20220802, 20220803, 20220804, 20220805], price: 5177, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=54161' },
    { dates: [20220919, 20220920, 20220921, 20220922, 20220923], price: 4952, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=54425' },
    { dates: [20221025, 20221027, 20221028], price: 5058, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=54605' },
    { dates: [20221121, 20221122, 20221123, 20221124, 20221125], price: 5254, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=54756' },
    { dates: [20221228, 20221229, 20221230], price: 5470, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=54971' },
    { dates: [20230123, 20230124, 20230125, 20230126, 20230127], price: 5717, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=55127' },
    { dates: [20230130, 20230131, 20230201, 20230202, 20230203], price: 5770, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=55167' },
    { dates: [20230320, 20230321, 20230322, 20230323, 20230324], price: 5921, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=55414' },
    { dates: [20230426, 20230427, 20230428], price: 6037, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=55599' },
    { dates: [20230522, 20230523, 20230524, 20230525, 20230526], price: 6047, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=55744' },
    { dates: [20230627, 20230628, 20230630], price: 5822, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=55964' },
    { dates: [20230724, 20230725, 20230726, 20230727, 20230728], price: 5950, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=56119' },
    { dates: [20230731, 20230801, 20230802, 20230803, 20230804], price: 5945, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=56150' },
    { dates: [20230918, 20230919, 20230920, 20230921, 20230922], price: 5921, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=56427' },
    { dates: [20231025, 20231026, 20231027], price: 6079, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=56645' },
    { dates: [20231120, 20231121, 20231122, 20231123, 20231124], price: 6132, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=56808' },
    { dates: [20231227, 20231228, 20231229], price: 6331, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=57037' },
    { dates: [20240115, 20240116, 20240117, 20240118, 20240119], price: 6239, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=57169' },
    { dates: [20240207, 20240208, 20240209], price: 6263, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=57300' },
    { dates: [20240318, 20240319, 20240320, 20240321, 20240322], price: 6601, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=57556' },
    { dates: [20240425, 20240426, 20240429], price: 7231, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=57810' },
    { dates: [20240522, 20240523, 20240524], price: 7296, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=57969' },
    { dates: [20240626, 20240627, 20240628], price: 7150, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=58191' },
    { dates: [20240715, 20240716, 20240717, 20240718, 20240719], price: 7337, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=58338' },
    { dates: [20240809, 20240812, 20240813], price: 7000, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=58492' },
    { dates: [20240923, 20240924, 20240925, 20240926, 20240927], price: 7517, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=58776' },
    { dates: [20241029, 20241030, 20241031], price: 7929, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=59010' },
    { dates: [20241122, 20241125, 20241126], price: 7685, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=59188' },
    { dates: [20241227, 20241230, 20241231], price: 7626, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=59428' },
    { dates: [20250120, 20250121, 20250122, 20250123, 20250124], price: 7988, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=59602' },
    { dates: [20250211, 20250212, 20250213], price: 8536, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=59748' },
    { dates: [20250310, 20250311, 20250312, 20250313], price: 8624, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=59976' },
    { dates: [20250425, 20250428, 20250429], price: 9558, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=60325' },
    { dates: [20250522, 20250523, 20250526], price: 9560, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=60527' },
    { dates: [20250626, 20250627, 20250630], price: 9628, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=60746' },
    { dates: [20250721, 20250722, 20250723, 20250724, 20250725], price: 9924, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=60904' },
    { dates: [20250811, 20250812, 20250813], price: 9991, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=61017' },
    { dates: [20250912, 20250915, 20250916], price: 11003, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=61223' },
    { dates: [20251027, 20251028, 20251029], price: 11992, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=61528' },
    { dates: [20251124, 20251125, 20251126], price: 12484, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=61686' },
    { dates: [20251229, 20251230, 20251231], price: 13486, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=61934' },
    { dates: [20260119, 20260120, 20260121], price: 14853, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=62079' },
    { dates: [20260210, 20260211, 20260212], price: 15641, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=62217' },
    { dates: [20260312, 20260313, 20260316], price: 15814, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=62387' },
    { dates: [20260428, 20260429, 20260430], price: 14901, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=62666' },
    { dates: [20260526, 20260527, 20260529], price: 15672, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=62836' },
    { dates: [20260625, 20260629, 20260630], price: 14086, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63057' },
    { dates: [20260717, 20260720, 20260721], price: 14218, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63206' },
    { dates: [20260812, 20260813, 20260814], price: 15295, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63381' },
    { dates: [20260911, 20260915, 20260916], price: 15173, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63604' },
    { dates: [20261028, 20261029, 20261030], price: 14167, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63897' },
    { dates: [20261119, 20261120, 20261123], price: 12612, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=64030' },
  ],
  silver: [
    { dates: [20250530], price: 97.458, source: 'IBJA silver 999 PM ₹97458/kg' },
    { dates: [20250627], price: 105.193, source: 'IBJA silver 999 PM ₹105193/kg' },
    { dates: [20250808], price: 114.732, source: 'IBJA silver 999 PM ₹114732/kg' },
    { dates: [20251128], price: 164.359, source: 'IBJA silver 999 PM ₹164359/kg' },
    { dates: [20251226], price: 228.107, source: 'IBJA silver 999 PM ₹228107/kg' },
    { dates: [20251231], price: 230.42, source: 'IBJA silver 999 PM ₹230420/kg' },
    { dates: [20260123], price: 317.705, source: 'IBJA silver 999 PM ₹317705/kg' },
    { dates: [20260227], price: 266.7, source: 'IBJA silver 999 PM ₹266700/kg' },
    { dates: [20260529], price: 263.35, source: 'IBJA silver 999 PM ₹263350/kg' },
    { dates: [20260731], price: 218.295, source: 'IBJA silver 999 PM ₹218295/kg' },
    { dates: [20260930], price: 220.435, source: 'IBJA silver 999 PM ₹220435/kg' },
    { dates: [20261127], price: 154.3, source: 'IBJA silver 999 PM ₹154300/kg' },
  ],
}
