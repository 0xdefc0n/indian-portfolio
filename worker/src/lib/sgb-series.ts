// Every Sovereign Gold Bond tranche (plan §21.5, M29): public RBI data. Shared with the SPA.
//
// Checked 2026-11-27: RBI's tranche table ("Data of Sovereign Gold Bonds (Tranche wise) issued till April 23, 2024"),
// each issue price against its RBI press release, issue dates against RBI calendars and redemption releases, ISINs
// against NSE bhavcopies. Interest 2.75% for the first five tranches, 2.5% from 2016-17 Series III. RBI's own names
// (the first three are "2015-I", "2016-I", "2016-II"). Two issue dates moved from the announced ones: 2015-I to
// 30 Nov 2015 and 2016-17 Series II to 30 Sep 2016. No tranche since February 2024.
export type SgbSeries = {
  /** Stable id stored in the inputs, e.g. '2015-I', '2017-18-IV'. */
  id: string
  /** RBI's name, e.g. '2015-I', '2017-18 Series IV'. */
  name: string
  /** Date of issue (interest runs from it; maturity 8 years later). */
  issue: string
  /** Issue price, ₹ per gram (the standard price, not the ₹50 online discount). */
  price: number
  /** Interest, % a year on the issue price, paid every six months. */
  coupon: number
  /** ISIN of the demat bond, when known. */
  isin: string | null
}

export const SGB_SERIES: readonly SgbSeries[] = [
  { id: '2015-I', name: '2015-I', issue: '2015-11-30', price: 2684, coupon: 2.75, isin: 'IN0020150085' },
  { id: '2016-I', name: '2016-I', issue: '2016-02-08', price: 2600, coupon: 2.75, isin: 'IN0020150101' },
  { id: '2016-II', name: '2016-II', issue: '2016-03-29', price: 2916, coupon: 2.75, isin: 'IN0020150119' },
  { id: '2016-17-I', name: '2016-17 Series I', issue: '2016-08-05', price: 3119, coupon: 2.75, isin: 'IN0020160027' },
  { id: '2016-17-II', name: '2016-17 Series II', issue: '2016-09-30', price: 3150, coupon: 2.75, isin: 'IN0020160043' },
  { id: '2016-17-III', name: '2016-17 Series III', issue: '2016-11-17', price: 3007, coupon: 2.5, isin: 'IN0020160076' },
  { id: '2016-17-IV', name: '2016-17 Series IV', issue: '2017-03-17', price: 2943, coupon: 2.5, isin: 'IN0020160126' },
  { id: '2017-18-I', name: '2017-18 Series I', issue: '2017-05-12', price: 2951, coupon: 2.5, isin: 'IN0020170018' },
  { id: '2017-18-II', name: '2017-18 Series II', issue: '2017-07-28', price: 2830, coupon: 2.5, isin: 'IN0020170034' },
  { id: '2017-18-III', name: '2017-18 Series III', issue: '2017-10-16', price: 2956, coupon: 2.5, isin: 'IN0020170059' },
  { id: '2017-18-IV', name: '2017-18 Series IV', issue: '2017-10-23', price: 2987, coupon: 2.5, isin: 'IN0020170067' },
  { id: '2017-18-V', name: '2017-18 Series V', issue: '2017-10-30', price: 2971, coupon: 2.5, isin: 'IN0020170075' },
  { id: '2017-18-VI', name: '2017-18 Series VI', issue: '2017-11-06', price: 2945, coupon: 2.5, isin: 'IN0020170083' },
  { id: '2017-18-VII', name: '2017-18 Series VII', issue: '2017-11-13', price: 2934, coupon: 2.5, isin: 'IN0020170091' },
  { id: '2017-18-VIII', name: '2017-18 Series VIII', issue: '2017-11-20', price: 2961, coupon: 2.5, isin: 'IN0020170109' },
  { id: '2017-18-IX', name: '2017-18 Series IX', issue: '2017-11-27', price: 2964, coupon: 2.5, isin: 'IN0020170117' },
  { id: '2017-18-X', name: '2017-18 Series X', issue: '2017-12-04', price: 2961, coupon: 2.5, isin: 'IN0020170125' },
  { id: '2017-18-XI', name: '2017-18 Series XI', issue: '2017-12-11', price: 2952, coupon: 2.5, isin: 'IN0020170133' },
  { id: '2017-18-XII', name: '2017-18 Series XII', issue: '2017-12-18', price: 2890, coupon: 2.5, isin: 'IN0020170141' },
  { id: '2017-18-XIII', name: '2017-18 Series XIII', issue: '2017-12-26', price: 2866, coupon: 2.5, isin: 'IN0020170158' },
  { id: '2017-18-XIV', name: '2017-18 Series XIV', issue: '2018-01-01', price: 2881, coupon: 2.5, isin: 'IN0020170166' },
  { id: '2018-19-I', name: '2018-19 Series I', issue: '2018-05-04', price: 3114, coupon: 2.5, isin: 'IN0020180033' },
  { id: '2018-19-II', name: '2018-19 Series II', issue: '2018-10-23', price: 3146, coupon: 2.5, isin: 'IN0020180249' },
  { id: '2018-19-III', name: '2018-19 Series III', issue: '2018-11-13', price: 3183, coupon: 2.5, isin: 'IN0020180314' },
  { id: '2018-19-IV', name: '2018-19 Series IV', issue: '2019-01-01', price: 3119, coupon: 2.5, isin: 'IN0020180389' },
  { id: '2018-19-V', name: '2018-19 Series V', issue: '2019-01-22', price: 3214, coupon: 2.5, isin: 'IN0020180462' },
  { id: '2018-19-VI', name: '2018-19 Series VI', issue: '2019-02-12', price: 3326, coupon: 2.5, isin: 'IN0020180561' },
  { id: '2019-20-I', name: '2019-20 Series I', issue: '2019-06-11', price: 3196, coupon: 2.5, isin: 'IN0020190073' },
  { id: '2019-20-II', name: '2019-20 Series II', issue: '2019-07-16', price: 3443, coupon: 2.5, isin: 'IN0020190081' },
  { id: '2019-20-III', name: '2019-20 Series III', issue: '2019-08-14', price: 3499, coupon: 2.5, isin: 'IN0020190107' },
  { id: '2019-20-IV', name: '2019-20 Series IV', issue: '2019-09-17', price: 3890, coupon: 2.5, isin: 'IN0020190115' },
  { id: '2019-20-V', name: '2019-20 Series V', issue: '2019-10-15', price: 3788, coupon: 2.5, isin: 'IN0020190370' },
  { id: '2019-20-VI', name: '2019-20 Series VI', issue: '2019-10-30', price: 3835, coupon: 2.5, isin: 'IN0020190388' },
  { id: '2019-20-VII', name: '2019-20 Series VII', issue: '2019-12-10', price: 3795, coupon: 2.5, isin: 'IN0020190461' },
  { id: '2019-20-VIII', name: '2019-20 Series VIII', issue: '2020-01-21', price: 4016, coupon: 2.5, isin: 'IN0020190537' },
  { id: '2019-20-IX', name: '2019-20 Series IX', issue: '2020-02-11', price: 4070, coupon: 2.5, isin: 'IN0020190545' },
  { id: '2019-20-X', name: '2019-20 Series X', issue: '2020-03-11', price: 4260, coupon: 2.5, isin: 'IN0020190552' },
  { id: '2020-21-I', name: '2020-21 Series I', issue: '2020-04-28', price: 4639, coupon: 2.5, isin: 'IN0020200062' },
  { id: '2020-21-II', name: '2020-21 Series II', issue: '2020-05-19', price: 4590, coupon: 2.5, isin: 'IN0020200088' },
  { id: '2020-21-III', name: '2020-21 Series III', issue: '2020-06-16', price: 4677, coupon: 2.5, isin: 'IN0020200104' },
  { id: '2020-21-IV', name: '2020-21 Series IV', issue: '2020-07-14', price: 4852, coupon: 2.5, isin: 'IN0020200146' },
  { id: '2020-21-V', name: '2020-21 Series V', issue: '2020-08-11', price: 5334, coupon: 2.5, isin: 'IN0020200161' },
  { id: '2020-21-VI', name: '2020-21 Series VI', issue: '2020-09-08', price: 5117, coupon: 2.5, isin: 'IN0020200195' },
  { id: '2020-21-VII', name: '2020-21 Series VII', issue: '2020-10-20', price: 5051, coupon: 2.5, isin: 'IN0020200203' },
  { id: '2020-21-VIII', name: '2020-21 Series VIII', issue: '2020-11-18', price: 5177, coupon: 2.5, isin: 'IN0020200286' },
  { id: '2020-21-IX', name: '2020-21 Series IX', issue: '2021-01-05', price: 5000, coupon: 2.5, isin: 'IN0020200377' },
  { id: '2020-21-X', name: '2020-21 Series X', issue: '2021-01-19', price: 5104, coupon: 2.5, isin: 'IN0020200385' },
  { id: '2020-21-XI', name: '2020-21 Series XI', issue: '2021-02-09', price: 4912, coupon: 2.5, isin: 'IN0020200393' },
  { id: '2020-21-XII', name: '2020-21 Series XII', issue: '2021-03-09', price: 4662, coupon: 2.5, isin: 'IN0020200427' },
  { id: '2021-22-I', name: '2021-22 Series I', issue: '2021-05-25', price: 4777, coupon: 2.5, isin: 'IN0020210053' },
  { id: '2021-22-II', name: '2021-22 Series II', issue: '2021-06-01', price: 4842, coupon: 2.5, isin: 'IN0020210061' },
  { id: '2021-22-III', name: '2021-22 Series III', issue: '2021-06-08', price: 4889, coupon: 2.5, isin: 'IN0020210087' },
  { id: '2021-22-IV', name: '2021-22 Series IV', issue: '2021-07-20', price: 4807, coupon: 2.5, isin: 'IN0020210111' },
  { id: '2021-22-V', name: '2021-22 Series V', issue: '2021-08-17', price: 4790, coupon: 2.5, isin: 'IN0020210129' },
  { id: '2021-22-VI', name: '2021-22 Series VI', issue: '2021-09-07', price: 4732, coupon: 2.5, isin: 'IN0020210145' },
  { id: '2021-22-VII', name: '2021-22 Series VII', issue: '2021-11-02', price: 4761, coupon: 2.5, isin: 'IN0020210178' },
  { id: '2021-22-VIII', name: '2021-22 Series VIII', issue: '2021-12-07', price: 4791, coupon: 2.5, isin: 'IN0020210228' },
  { id: '2021-22-IX', name: '2021-22 Series IX', issue: '2022-01-18', price: 4786, coupon: 2.5, isin: 'IN0020210236' },
  { id: '2021-22-X', name: '2021-22 Series X', issue: '2022-03-08', price: 5109, coupon: 2.5, isin: 'IN0020210319' },
  { id: '2022-23-I', name: '2022-23 Series I', issue: '2022-06-28', price: 5091, coupon: 2.5, isin: 'IN0020220045' },
  { id: '2022-23-II', name: '2022-23 Series II', issue: '2022-08-30', price: 5197, coupon: 2.5, isin: 'IN0020220078' },
  { id: '2022-23-III', name: '2022-23 Series III', issue: '2022-12-27', price: 5409, coupon: 2.5, isin: 'IN0020220110' },
  { id: '2022-23-IV', name: '2022-23 Series IV', issue: '2023-03-14', price: 5611, coupon: 2.5, isin: 'IN0020220169' },
  { id: '2023-24-I', name: '2023-24 Series I', issue: '2023-06-27', price: 5926, coupon: 2.5, isin: 'IN0020230069' },
  { id: '2023-24-II', name: '2023-24 Series II', issue: '2023-09-20', price: 5923, coupon: 2.5, isin: 'IN0020230093' },
  { id: '2023-24-III', name: '2023-24 Series III', issue: '2023-12-28', price: 6199, coupon: 2.5, isin: 'IN0020230168' },
  { id: '2023-24-IV', name: '2023-24 Series IV', issue: '2024-02-21', price: 6263, coupon: 2.5, isin: 'IN0020230184' },
]
