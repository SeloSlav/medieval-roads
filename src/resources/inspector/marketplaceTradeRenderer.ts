import type { BuildingState } from '../types.ts';
import {
  canAffordCommodityTrade,
  canAffordMarketplaceTrade,
  canAffordWaterCommodityTrade,
  describeCommodityOffer,
  describeMarketplaceTradeOfferForMarket,
  describeWaterCommodityOffer,
  formatTradeAvailabilitySummary,
  MARKET_COMMODITIES,
  MARKET_WATER_COMMODITIES,
  marketplaceTradeOffersBySection,
} from '../../economy/marketplaceTrade.ts';
import type { MarketplaceTradeAvailability } from '../../economy/marketplaceTrade.ts';
import type { RegionalMarketState } from '../../economy/regionalMarket.ts';
import { formatPriceMultiplier, priceMultiplierFor } from '../../economy/regionalMarket.ts';

export function renderMarketplaceTradePanel(
  building: BuildingState,
  availability: MarketplaceTradeAvailability,
  marketState: RegionalMarketState,
): string {
  const sections = marketplaceTradeOffersBySection();
  const renderOffer = (offer: (typeof sections.goldBuy)[number]) => {
    const affordable = canAffordMarketplaceTrade(availability, offer, marketState);
    const disabled = affordable ? '' : ' disabled aria-disabled="true"';
    const priceTag =
      offer.kind === 'goldBuy' || offer.kind === 'goldSell'
        ? formatPriceMultiplier(priceMultiplierFor(marketState, offer.resource))
        : null;
    const hint =
      offer.kind === 'goldBuy' || offer.kind === 'goldSell'
        ? priceTag ?? 'Regional caravan rates'
        : 'Direct barter — no gold involved';
    return `
      <li class="marketplace-trade-row">
        <button
          type="button"
          class="marketplace-trade-option"
          data-inspector-action="marketplace-trade"
          data-trade-id="${offer.id}"
          data-building-id="${building.id}"
          ${disabled}
        >
          <span class="marketplace-trade-option__title">${describeMarketplaceTradeOfferForMarket(offer, marketState)}</span>
          <span class="marketplace-trade-option__hint">${hint}</span>
        </button>
      </li>`;
  };

  const renderFoodCommodity = (commodity: (typeof MARKET_COMMODITIES)[number]) => {
    const affordable = canAffordCommodityTrade(availability, commodity, marketState);
    const disabled = affordable ? '' : ' disabled aria-disabled="true"';
    const priceTag = formatPriceMultiplier(marketState.foodPriceMult);
    return `
      <li class="marketplace-trade-row">
        <button
          type="button"
          class="marketplace-trade-option marketplace-trade-option--provender"
          data-inspector-action="marketplace-trade"
          data-trade-id="${commodity.id}"
          data-building-id="${building.id}"
          ${disabled}
        >
          <span class="marketplace-trade-option__title">${describeCommodityOffer(commodity, marketState)}</span>
          <span class="marketplace-trade-option__hint">${commodity.origin} · delivered to homes${priceTag ? ` · ${priceTag}` : ''}</span>
        </button>
      </li>`;
  };

  const renderWaterCommodity = (commodity: (typeof MARKET_WATER_COMMODITIES)[number]) => {
    const affordable = canAffordWaterCommodityTrade(availability, commodity, marketState);
    const disabled = affordable ? '' : ' disabled aria-disabled="true"';
    const priceTag = formatPriceMultiplier(marketState.firewoodPriceMult);
    return `
      <li class="marketplace-trade-row">
        <button
          type="button"
          class="marketplace-trade-option marketplace-trade-option--water"
          data-inspector-action="marketplace-trade"
          data-trade-id="${commodity.id}"
          data-building-id="${building.id}"
          ${disabled}
        >
          <span class="marketplace-trade-option__title">${describeWaterCommodityOffer(commodity, marketState)}</span>
          <span class="marketplace-trade-option__hint">${commodity.origin} · delivered to homes${priceTag ? ` · ${priceTag}` : ''}</span>
        </button>
      </li>`;
  };

  return `
    <div class="marketplace-trade-panel">
      <p class="marketplace-trade-bulletin">${marketState.bulletin}</p>
      <p class="marketplace-trade-intro">Trade with caravans from neighboring regions. Provender and water orders are hauled by cart to road-linked homes. Households with savings auto-order when food or water runs low.</p>
      <p class="marketplace-trade-stock">${formatTradeAvailabilitySummary(availability)}</p>
      <section class="marketplace-trade-section" aria-label="Provender">
        <h3 class="marketplace-trade-section__title">Provender — regional market</h3>
        <ul class="marketplace-trade-list">${MARKET_COMMODITIES.map(renderFoodCommodity).join('')}</ul>
      </section>
      <section class="marketplace-trade-section" aria-label="Water imports">
        <h3 class="marketplace-trade-section__title">Water imports</h3>
        <ul class="marketplace-trade-list">${MARKET_WATER_COMMODITIES.map(renderWaterCommodity).join('')}</ul>
      </section>
      <section class="marketplace-trade-section" aria-label="Buy with gold">
        <h3 class="marketplace-trade-section__title">Buy bulk goods</h3>
        <ul class="marketplace-trade-list">${sections.goldBuy.map(renderOffer).join('')}</ul>
      </section>
      <section class="marketplace-trade-section" aria-label="Sell for gold">
        <h3 class="marketplace-trade-section__title">Sell for gold</h3>
        <ul class="marketplace-trade-list">${sections.goldSell.map(renderOffer).join('')}</ul>
      </section>
      <section class="marketplace-trade-section" aria-label="Barter">
        <h3 class="marketplace-trade-section__title">Barter</h3>
        <ul class="marketplace-trade-list">${sections.barter.map(renderOffer).join('')}</ul>
      </section>
    </div>`;
}
