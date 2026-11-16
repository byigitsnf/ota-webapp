/* =========================================================
   API uçları — Azure Functions'tan ve yerel geliştirme sunucusundan
   aynı şekilde çağrılır. Her işleyici { status, body } döndürür.

   GET /api/catalog        Sitenin ihtiyaç duyduğu her şey tek yanıtta
   GET /api/tours          Turlar; ?scope=yurtici|yurtdisi  ?continent=avrupa  ?transport=Gemi
   GET /api/tours/{id}     Tek tur
   GET /api/visa           Vize rehberi
   GET /api/live/{id}      Turun uçuş hattında şu an havada olan İstanbul kalkışlı uçaklar (OpenSky)
   GET /api/hotels         Otel arama; ?lat=&lon=&checkin=&checkout=&adults= (LiteAPI)
   GET /api/hotels/{id}    Otel bilgisi ve oda seçenekleri; aynı tarih parametreleriyle
   POST /api/hotels/prebook  { offerId } → fiyat ve müsaitlik doğrulaması
   POST /api/hotels/book     { prebookId, firstName, lastName, email } → rezervasyon (sandbox)
   GET /api/routes/{id}    Turun durakları ve rotası (Amazon Location)
   GET /api/map/...        Harita stili ve parçaları; anahtar sunucuda eklenir
   GET /api/health         Hangi veri kaynağının kullanıldığı

   Ücretli ya da kotalı servislere giden uçlar guard.js ile korunur.
   Tarihi geçen turlar listelerde ended: true ile görünür; tek tur, uçuş
   takibi ve rota uçları bu turlar için 410 döner (bkz. tour-status.js).
   ========================================================= */

const { getStore } = require("./store");
const { liveFlightsTo, hasCredentials, OpenSkyError } = require("./opensky");
const hotels = require("./liteapi");
const location = require("./location");
const { protect } = require("./guard");
const { isEnded, withStatus, todayIso, ENDED_RESPONSE } = require("./tour-status");

const ok = (body) => ({ status: 200, body });
const notFound = (message) => ({ status: 404, body: { error: message } });

const TOUR_FILTERS = ["scope", "continent", "transport"];

async function catalog() {
  const store = getStore();
  const [tours, meta] = await Promise.all([store.listTours(), store.getMeta()]);
  const today = todayIso();
  return ok({ source: store.source, today, tours: tours.map((tour) => withStatus(tour, today)), ...meta });
}

async function listTours(query) {
  const today = todayIso();
  const tours = (await getStore().listTours()).map((tour) => withStatus(tour, today));
  const filtered = tours.filter((tour) =>
    TOUR_FILTERS.every((key) => !query[key] || tour[key] === query[key])
  );
  return ok(filtered);
}

async function getTour(_query, { id }) {
  const tour = await getStore().getTour(id);
  if (!tour) return notFound(`"${id}" kodlu tur bulunamadı`);
  return isEnded(tour) ? ENDED_RESPONSE : ok(withStatus(tour));
}

async function visa() {
  const { visaInfo } = await getStore().getMeta();
  return ok(visaInfo);
}

async function liveFlights(_query, { id }) {
  const tour = await getStore().getTour(id);
  if (!tour) return notFound(`"${id}" kodlu tur bulunamadı`);
  if (isEnded(tour)) return ENDED_RESPONSE;
  const code = tour.flight?.outbound?.to;
  if (!code) return { status: 400, body: { error: "Bu tur uçaklı değil" } };

  try {
    return ok(await liveFlightsTo(code));
  } catch (error) {
    if (!(error instanceof OpenSkyError)) throw error;
    return { status: error.status === 404 ? 404 : 503, body: { error: error.message, retryAfter: error.retryAfter } };
  }
}

/** LiteAPI hatalarını kullanıcıya gösterilecek mesajla döndürür. */
const hotelRoute = (run) => async (query, params, body) => {
  try {
    return ok(await run(query, params, body));
  } catch (error) {
    if (!(error instanceof hotels.LiteApiError)) throw error;
    return { status: error.status, body: { error: error.message } };
  }
};

/** Sona eren turun rotası istenmez; bilinmeyen id'yi işleyici kendisi 404 ile karşılar. */
const activeTourOnly = (handler) => async (query, params, body, context) => {
  const tour = await getStore().getTour(params.id);
  return tour && isEnded(tour) ? ENDED_RESPONSE : handler(query, params, body, context);
};

async function health() {
  return ok({
    status: "ok",
    source: getStore().source,
    opensky: hasCredentials() ? "hesap" : "hesapsız",
    hotels: hotels.hotelsStatus(),
    location: location.locationStatus(),
    time: new Date().toISOString()
  });
}

/**
 * route: Azure Functions rota şablonu; handler: (query, params, body) => Promise<{status, body}>
 * method: "GET" (varsayılan) ya da "POST"; POST yanıtları önbelleğe alınmaz
 * maxAge: tarayıcı önbellek süresi (sn), verilmezse 60
 * Dönüşte raw (Buffer) + contentType ikili yanıt, cacheControl önbellek başlığı verir.
 */
const ROUTES = [
  { name: "catalog", route: "catalog", handler: catalog },
  { name: "tours", route: "tours", handler: listTours },
  { name: "tour", route: "tours/{id}", handler: getTour },
  { name: "visa", route: "visa", handler: visa },
  { name: "live", route: "live/{id}", handler: protect("live", 60, liveFlights), maxAge: 15 },
  { name: "hotelSearch", route: "hotels", handler: protect("hotels", 30, hotelRoute(hotels.searchHotels)), maxAge: 120 },
  { name: "hotelPrebook", route: "hotels/prebook", method: "POST", handler: protect("hotelPrebook", 10, hotelRoute((_q, _p, body) => hotels.prebook(body))) },
  { name: "hotelBook", route: "hotels/book", method: "POST", handler: protect("hotelBook", 5, hotelRoute((_q, _p, body) => hotels.book(body))) },
  { name: "hotel", route: "hotels/{id}", handler: protect("hotels", 30, hotelRoute(hotels.getHotel)), maxAge: 120 },
  { name: "tourRoute", route: "routes/{id}", handler: protect("routes", 30, activeTourOnly(location.tourRoute)) },
  { name: "mapAsset", route: "map/{*path}", handler: protect("map", 900, location.mapAsset) },
  { name: "health", route: "health", handler: health }
];

module.exports = { ROUTES };
