export const PLAN_PRICES = {
  monthly: 19,
  lifetime: 19,
} as const;

export const COUPON_CODES = {
  BYPASS: 100, // 100% discount
} as const;

//  {/* Weekly Plan */}
//  <button
//  onClick={() => setSelectedPlan("weekly")}
//  className={`w-full bg-white/5 px-3 sm:px-5 md:px-4 py-1.5 rounded-xl flex items-center justify-between ${
//    selectedPlan === "weekly" ? "border border-white" : ""
//  }`}
// >
//  {/* Weekly plan content */}
//  <div className="flex items-center gap-2 sm:gap-4 md:gap-3 pt-2 pb-2 sm:pt-3 sm:pb-3 md:pt-2 md:pb-2">
//    <div className="flex flex-col">
//      <div className="flex items-center gap-1 sm:gap-2 mb-0.5 sm:mb-1">
//        <span className="text-white text-base sm:text-lg md:text-base font-medium leading-none">
//          Weekly
//        </span>
//        <span className="text-white/60 text-[8px] xs:text-[10px] sm:text-xs md:text-[10px] px-1.5 sm:px-2 py-0.5 font-semibold rounded bg-white/30 leading-none">
//          Basic
//        </span>
//      </div>
//      <div className="mt-1 flex items-baseline text-white/60">
//        <span className="text-base sm:text-lg md:text-base leading-none">
//          {getPriceDisplay(
//            "weekly",
//            PLAN_PRICES.weekly,
//            discountedPrices.weekly
//          )}
//        </span>
//        <span className="text-[9px] xs:text-[10px] sm:text-xs md:text-[10px] ml-1 sm:ml-2 leading-none">
//          - 6 Hours Talktime
//        </span>
//      </div>
//    </div>
//  </div>
//  {selectedPlan === "weekly" && (
//    <div className="w-6 h-6 sm:w-8 sm:h-8 md:w-6 md:h-6 rounded-full bg-white flex items-center justify-center">
//      <svg
//        xmlns="http://www.w3.org/2000/svg"
//        className="h-3 w-3 sm:h-4 sm:w-4 md:h-3 md:w-3 text-[#741942]"
//        viewBox="0 0 20 20"
//        fill="currentColor"
//      >
//        <path
//          fillRule="evenodd"
//          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
//          clipRule="evenodd"
//        />
//      </svg>
//    </div>
//  )}
// </button>
