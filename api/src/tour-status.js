/* =========================================================
   Tur durumu: son kalkış tarihi geçmiş turlar "sona erdi" sayılır.
   Bu turlar katalogda ended: true ile listelenmeye devam eder (arayüz onları
   soluk ve kapalı gösterir); tek tur, uçuş takibi ve rota uçları ise 410 döner.
   Tarihler İstanbul saatine göre karşılaştırılır.
   ========================================================= */

const TIME_ZONE = "Europe/Istanbul";

/** Bugünün tarihi, YYYY-MM-DD (İstanbul saatiyle). */
const todayIso = (now = new Date()) => now.toLocaleDateString("sv-SE", { timeZone: TIME_ZONE });

/** Kalkış tarihlerinin hepsi geçmişteyse tur sona ermiştir. Tarihi olmayan tur açık sayılır. */
const isEnded = (tour, today = todayIso()) =>
  Array.isArray(tour.dates) && tour.dates.length > 0 && tour.dates.every((date) => date < today);

/** Katalog yanıtı için turu durum alanıyla döndürür. */
const withStatus = (tour, today = todayIso()) => ({ ...tour, ended: isEnded(tour, today) });

const ENDED_RESPONSE = { status: 410, body: { error: "Bu tur sona erdi", ended: true } };

module.exports = { todayIso, isEnded, withStatus, ENDED_RESPONSE };
