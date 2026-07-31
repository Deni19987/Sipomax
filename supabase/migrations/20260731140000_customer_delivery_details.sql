-- Sparade leveransuppgifter på kundkortet.
--
-- Kunden fyller i leveransuppgifter i kassan och kan välja att spara dem.
-- Sparade uppgifter ligger här och förifyller nästa beställning.
--
-- Egna delivery_*-kolumner i stället för att återanvända company_*/
-- workshop_address: de fälten är verkstadens egna faktureringsuppgifter och
-- betyder något helt annat.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS delivery_recipient text,
  ADD COLUMN IF NOT EXISTS delivery_street text,
  ADD COLUMN IF NOT EXISTS delivery_postal_code text,
  ADD COLUMN IF NOT EXISTS delivery_city text,
  ADD COLUMN IF NOT EXISTS delivery_country text,
  ADD COLUMN IF NOT EXISTS delivery_note text;
