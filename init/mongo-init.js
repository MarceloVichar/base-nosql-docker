/**
 * Initial data for the self-service ordering system.
 * Executed by MongoDB when initializing an empty volume.
 * English schema; customer-facing content remains in Portuguese.
 */
db = db.getSiblingDB("totem_ordering_system");

for (const name of ["stores", "categories", "products", "orders"]) {
  db.createCollection(name);
}

db.categories.createIndex({ name: 1 }, { unique: true });
db.products.createIndex({ store_id: 1, available: 1, name: 1, _id: 1 });
db.products.createIndex({ store_id: 1, category_id: 1, available: 1, name: 1, _id: 1 });
db.orders.createIndex({ store_id: 1, status: 1, created_at: 1, _id: 1 });

const stores = [
  {
    name: "Estação do Lanche — Centro",
    active: true,
    address: {
      street: "Rua XV de Novembro", number: "880", neighborhood: "Centro",
      city: "Guarapuava", state: "PR", postal_code: "85010-000"
    },
    settings: { estimated_preparation_minutes: NumberInt(15), allows_customization: true },
    created_at: new Date("2026-09-08T12:00:00Z")
  },
  {
    name: "Estação do Lanche — Santa Cruz",
    active: true,
    address: {
      street: "Rua Padre Salvador", number: "420", neighborhood: "Santa Cruz",
      city: "Guarapuava", state: "PR", postal_code: "85015-430"
    },
    settings: { estimated_preparation_minutes: NumberInt(20), allows_customization: true },
    created_at: new Date("2026-09-08T12:05:00Z")
  }
];

const storeIds = db.stores.insertMany(stores).insertedIds;

const categories = [
  { name: "Lanches", description: "Hambúrgueres e sanduíches preparados na loja", display_order: NumberInt(1), active: true },
  { name: "Bebidas", description: "Sucos e bebidas geladas", display_order: NumberInt(2), active: true },
  { name: "Acompanhamentos", description: "Porções para acompanhar o lanche", display_order: NumberInt(3), active: true },
  { name: "Sobremesas", description: "Doces e sobremesas individuais", display_order: NumberInt(4), active: false }
].map(category => ({ ...category, created_at: new Date("2026-09-08T12:10:00Z") }));

const categoryIds = db.categories.insertMany(categories).insertedIds;

// Each row represents a store-specific product with independent stock.
// Sample nutrition per unit: kcal, protein, carbohydrates and fat.
const catalog = [
  [storeIds[0], categoryIds[0], "Big Burger Bacon", "Hambúrguer artesanal com queijo, bacon e molho especial", 3290, 150, true, false, ["Pão brioche", "Hambúrguer 180g", "Queijo", "Bacon", "Molho especial"], ["hamburguer", "bacon", "mais_vendidos"], [720, 32.5, 48, 39.2, true]],
  [storeIds[0], categoryIds[0], "Sanduíche de Frango", "Frango grelhado com salada no pão integral", 2490, 40, true, true, ["Pão integral", "Frango", "Alface", "Tomate"], ["frango", "grelhado"], [410, 29, 42, 13, true]],
  [storeIds[0], categoryIds[1], "Suco de Laranja 300 ml", "Suco natural de laranja sem açúcar adicionado", 990, 30, true, false, ["Laranja"], ["suco", "gelado"], [135, 2, 31, 0.5, false]],
  [storeIds[0], categoryIds[1], "Água Mineral 500 ml", "Água mineral sem gás", 500, 0, true, false, ["Água mineral"], ["agua"], [0, 0, 0, 0, false]],
  [storeIds[0], categoryIds[2], "Batata Rústica", "Porção de batatas com casca e alecrim", 1690, 35, true, true, ["Batata", "Óleo vegetal", "Sal", "Alecrim"], ["porcao"], [360, 4, 48, 17, false]],
  [storeIds[0], categoryIds[3], "Brownie Individual", "Brownie de chocolate", 1290, 10, false, false, ["Chocolate", "Farinha de trigo", "Ovo", "Manteiga", "Açúcar"], ["chocolate"], [320, 5, 39, 16, true]],
  [storeIds[1], categoryIds[0], "Big Burger Bacon", "Hambúrguer artesanal com queijo, bacon e molho especial", 3490, 70, true, true, ["Pão brioche", "Hambúrguer 180g", "Queijo", "Bacon", "Molho especial"], ["hamburguer", "bacon"], [720, 32.5, 48, 39.2, true]],
  [storeIds[1], categoryIds[0], "Burger de Grão-de-Bico", "Hambúrguer de grão-de-bico com salada", 2890, 25, true, false, ["Pão", "Grão-de-bico", "Alface", "Tomate"], ["vegetariano"], [430, 16, 58, 15, true]],
  [storeIds[1], categoryIds[1], "Suco de Uva 300 ml", "Suco integral de uva", 1090, 45, true, false, ["Suco de uva integral"], ["suco", "gelado"], [180, 1, 44, 0, false]],
  [storeIds[1], categoryIds[1], "Água Mineral 500 ml", "Água mineral sem gás", 500, 60, true, false, ["Água mineral"], ["agua"], [0, 0, 0, 0, false]],
  [storeIds[1], categoryIds[2], "Anéis de Cebola", "Porção de cebolas empanadas", 1890, 20, true, false, ["Cebola", "Farinha de trigo", "Óleo vegetal", "Sal"], ["porcao", "crocante"], [390, 5, 46, 21, true]],
  [storeIds[1], categoryIds[3], "Pudim Individual", "Pudim de leite com calda de caramelo", 1190, 15, true, false, ["Leite", "Leite condensado", "Ovo", "Açúcar"], ["doce"], [280, 7, 45, 8, false]]
];

const products = catalog.map(([store, category, name, description, price, stock, available, featured, ingredients, tags, nutrients], index) => ({
  store_id: store, category_id: category, name, description,
  price_cents: NumberInt(price), stock: NumberInt(stock), available, featured,
  nutrition: {
    calories: Double(nutrients[0]), protein: Double(nutrients[1]),
    carbohydrates: Double(nutrients[2]), fat: Double(nutrients[3]),
    contains_gluten: nutrients[4]
  },
  ingredients, tags,
  customization_groups: [0, 6].includes(index) ? [{
    name: "Adicionais", minimum: NumberInt(0), maximum: NumberInt(2),
    options: [
      { name: "Bacon extra", additional_price_cents: NumberInt(450) },
      { name: "Queijo extra", additional_price_cents: NumberInt(300) }
    ]
  }] : [],
  created_at: new Date("2026-09-08T13:00:00Z")
}));

const productIds = db.products.insertMany(products).insertedIds;

// Snapshot commercial data to preserve order history.
function createItem(productIndex, quantity, withBacon = false, note = "") {
  const product = products[productIndex];
  if (!product) throw new Error(`Product not found: ${productIndex}`);
  const customizations = withBacon ? [{
    group: "Adicionais", option: "Bacon extra", additional_price_cents: NumberInt(450)
  }] : [];
  const unitPrice = Number(product.price_cents) + (withBacon ? 450 : 0);
  return {
    product_id: productIds[productIndex], product_name: product.name, quantity: NumberInt(quantity),
    base_price_cents: product.price_cents, customizations,
    unit_price_cents: NumberInt(unitPrice),
    subtotal_cents: NumberInt(unitPrice * quantity), note
  };
}

function createOrder(store, terminal, status, createdAt, updatedAt, items) {
  return {
    store_id: store, terminal_code: terminal, status, items,
    total_cents: NumberInt(items.reduce((total, item) => total + Number(item.subtotal_cents), 0)),
    created_at: new Date(createdAt), updated_at: new Date(updatedAt)
  };
}

const orders = [
  createOrder(storeIds[0], "TOTEM-01", "completed", "2026-09-09T15:30:00Z", "2026-09-09T15:48:00Z", [createItem(0, 2, true, "Sem molho especial")]),
  createOrder(storeIds[0], "TOTEM-02", "completed", "2026-09-09T16:00:00Z", "2026-09-09T16:20:00Z", [createItem(1, 1), createItem(2, 1)]),
  createOrder(storeIds[0], "TOTEM-01", "cancelled", "2026-09-09T17:00:00Z", "2026-09-09T17:02:00Z", [createItem(0, 1)]),
  createOrder(storeIds[1], "TOTEM-01", "completed", "2026-09-09T15:40:00Z", "2026-09-09T16:00:00Z", [createItem(6, 1, true), createItem(8, 2)]),
  createOrder(storeIds[1], "TOTEM-02", "completed", "2026-09-09T18:00:00Z", "2026-09-09T18:25:00Z", [createItem(7, 2), createItem(10, 1)]),
  createOrder(storeIds[1], "TOTEM-01", "cancelled", "2026-09-09T19:00:00Z", "2026-09-09T19:03:00Z", [createItem(6, 1)]),
  createOrder(storeIds[0], "TOTEM-01", "completed", "2026-09-10T14:00:00Z", "2026-09-10T14:20:00Z", [createItem(0, 1), createItem(4, 1)]),
  createOrder(storeIds[1], "TOTEM-01", "completed", "2026-09-10T14:10:00Z", "2026-09-10T14:35:00Z", [createItem(6, 2), createItem(9, 2)]),
  createOrder(storeIds[0], "TOTEM-02", "received", "2026-09-10T15:00:00Z", "2026-09-10T15:00:00Z", [createItem(1, 2), createItem(2, 2)]),
  createOrder(storeIds[0], "TOTEM-01", "preparing", "2026-09-10T14:55:00Z", "2026-09-10T15:01:00Z", [createItem(0, 1, true), createItem(4, 1)]),
  createOrder(storeIds[1], "TOTEM-02", "ready", "2026-09-10T14:40:00Z", "2026-09-10T15:00:00Z", [createItem(7, 1), createItem(8, 1)]),
  createOrder(storeIds[1], "TOTEM-01", "received", "2026-09-10T15:02:00Z", "2026-09-10T15:02:00Z", [createItem(6, 1), createItem(10, 1)])
];

// Check each item belongs to the order's store before inserting orders.
for (const order of orders) {
  for (const item of order.items) {
    const productIndex = Object.values(productIds).findIndex(id => id.equals(item.product_id));
    if (productIndex < 0 || !products[productIndex].store_id.equals(order.store_id)) {
      throw new Error("Order item belongs to another store");
    }
  }
}

db.orders.insertMany(orders);
print("Totem Ordering System: 30 documents inserted with generated ObjectIds.");
for (const [index, store] of stores.entries()) print(`Store ${store.name}: ${storeIds[index]}`);
for (const [index, category] of categories.entries()) print(`Category ${category.name}: ${categoryIds[index]}`);
