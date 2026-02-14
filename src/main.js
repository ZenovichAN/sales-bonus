/**
 * Функция для расчета выручки (по одной позиции товара в чеке)
 * @param purchase запись о покупке (один item из record.items)
 * @param _product карточка товара (по ТЗ может передаваться, но здесь не нужна)
 * @returns {number} выручка по позиции с учётом скидки
 */
function calculateSimpleRevenue(purchase, _product) {
  // Достаём нужные поля из покупки
  const { discount, sale_price, quantity } = purchase;

  // Коэффициент "сколько остаётся после скидки":
  // 1 - (скидка% / 100)
  const discountCoef = 1 - (discount / 100);

  // Выручка по позиции = цена продажи * количество * коэффициент скидки
  return sale_price * quantity * discountCoef;
}

/**
 * Функция для расчета бонусов (в рублях, не процент)
 * @param index место в рейтинге (0 — самый прибыльный)
 * @param total общее число продавцов
 * @param seller карточка продавца со статистикой (profit уже посчитан)
 * @returns {number} бонус в рублях
 */
function calculateBonusByProfit(index, total, seller) {
  const { profit } = seller;

  // 15% — 1 место
  if (index === 0) {
    return profit * 0.15;
  }
  // 10% — 2 и 3 место
  else if (index === 1 || index === 2) {
    return profit * 0.10;
  }
  // 0% — последнее место
  else if (index === total - 1) {
    return 0;
  }
  // 5% — все остальные
  else {
    return profit * 0.05;
  }
}

/**
 * Функция для анализа данных продаж
 * @param data объект со всеми коллекциями
 * @param options объект с функциями расчёта
 * @returns {{revenue, top_products, bonus, name, sales_count, profit, seller_id}[]}
 */
function analyzeSalesData(data, options) {
  // =========================================================
  // ШАГ 1. Проверка входных данных
  // =========================================================
  if (
    !data ||
    !Array.isArray(data.sellers) ||
    !Array.isArray(data.products) ||
    !Array.isArray(data.purchase_records) ||
    data.sellers.length === 0 ||
    data.products.length === 0 ||
    data.purchase_records.length === 0
  ) {
    throw new Error("Некорректные входные данные");
  }

  // =========================================================
  // ШАГ 2. Проверка наличия опций
  // =========================================================
  if (!options || typeof options !== "object") {
    throw new Error("Некорректные опции");
  }

  const { calculateRevenue, calculateBonus } = options;

  if (
    !calculateRevenue ||
    !calculateBonus ||
    typeof calculateRevenue !== "function" ||
    typeof calculateBonus !== "function"
  ) {
    throw new Error("Не переданы функции расчёта");
  }

  // =========================================================
  // ШАГ 3. Подготовка промежуточных данных sellerStats
  // =========================================================
  // ВАЖНО: по методичке это именно массив через map
  const sellerStats = data.sellers.map((seller) => ({
    id: seller.id,
    name: `${seller.first_name} ${seller.last_name}`,
    revenue: 0,
    profit: 0,
    sales_count: 0,
    products_sold: {}, // sku -> quantity
    // бонус и top_products добавим позже
  }));

  // =========================================================
  // ШАГ 4. Индексация продавцов и товаров (быстрый доступ)
  // =========================================================
  // sellerIndex: id -> запись из sellerStats
  const sellerIndex = Object.fromEntries(
    sellerStats.map((s) => [s.id, s])
  );

  // productIndex: sku -> запись из data.products
  const productIndex = Object.fromEntries(
    data.products.map((p) => [p.sku, p])
  );

  // =========================================================
  // ЭТАП 3. БИЗНЕС-ЛОГИКА
  // =========================================================

  // ---------------------------------------------------------
  // ШАГ 1. Двойной цикл: по чекам и по товарам в чеке
  // ---------------------------------------------------------
  data.purchase_records.forEach((record) => {
    const seller = sellerIndex[record.seller_id];

    // Если вдруг продавца нет в индексе — пропускаем чек
    if (!seller) return;

    // Увеличить количество продаж (чек = 1 продажа)
    seller.sales_count += 1;

    // По методичке: выручка продавца увеличивается на сумму чека total_amount
    seller.revenue += record.total_amount;

    // Прибыль считаем по каждой позиции в чеке
    record.items.forEach((item) => {
      const product = productIndex[item.sku];

      // Если товар не найден — пропускаем позицию
      if (!product) return;

      // Себестоимость = закупочная цена * количество
      const cost = product.purchase_price * item.quantity;

      // Выручка по позиции (с учётом скидки) — через calculateRevenue
      const revenue = calculateRevenue(item, product);

      // Прибыль по позиции
      const profit = revenue - cost;

      // Накопить прибыль продавца
      seller.profit += profit;

      // Учёт количества проданных товаров
      if (!seller.products_sold[item.sku]) {
        seller.products_sold[item.sku] = 0;
      }
      // Увеличиваем проданное количество по SKU на количество из чека
      seller.products_sold[item.sku] += item.quantity;
    });
  });

  // ---------------------------------------------------------
  // ШАГ 2. Сортировка продавцов по убыванию прибыли
  // ---------------------------------------------------------
  sellerStats.sort((a, b) => b.profit - a.profit);

  // ---------------------------------------------------------
  // ШАГ 3. Назначение бонусов и формирование top_products
  // ---------------------------------------------------------
  sellerStats.forEach((seller, index) => {
    // Бонус считаем стратегией calculateBonus
    seller.bonus = calculateBonus(index, sellerStats.length, seller);

    // Топ-10 товаров:
    // 1) entries -> [[sku, quantity], ...]
    // 2) map -> [{ sku, quantity }, ...]
    // 3) sort по quantity desc
    // 4) slice(0, 10)
    seller.top_products = Object.entries(seller.products_sold)
      .map(([sku, quantity]) => ({ sku, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);
  });

  // ---------------------------------------------------------
  // ШАГ 4. Формирование результата (округление до 2 знаков)
  // ---------------------------------------------------------
  return sellerStats.map((seller) => ({
    seller_id: seller.id,
    name: seller.name,
    revenue: +seller.revenue.toFixed(2),
    profit: +seller.profit.toFixed(2),
    sales_count: seller.sales_count,
    top_products: seller.top_products,
    bonus: +seller.bonus.toFixed(2),
  }));
}
