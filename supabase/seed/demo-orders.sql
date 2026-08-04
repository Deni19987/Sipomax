-- Demodata: 20 exempelordrar över butikens produktkategorier.
--
-- Körs manuellt mot en miljö där man vill ha exempeldata — den ligger
-- medvetet INTE i supabase/migrations, eftersom demodata inte hör hemma i
-- schemahistoriken.
--
-- Rensa allt igen med:
--   delete from public.workshop_messages where sender_id = '22222222-0000-4000-8000-000000000001';
--   delete from public.shop_orders where id::text like '11111111-0000-4000-8000-%';
-- (orderrader och historik försvinner via on delete cascade)

begin;
with o(n,cname,slug,status,days,hrs,note) as (values
(1,'Nordvik Bilvård','nordvik','mottagen',0,17,null),
(2,'Kungsbacka Biltvätt','kungsbacka','mottagen',0,14,'Ringde och vill ha leverans före fredag'),
(3,'Rekond Syd AB','rekondsyd','mottagen',1,11,null),
(4,'Bilglans i Väst','bilglans','mottagen',1,8,null),
(5,'Motorstaden Service','motorstaden','mottagen',2,5,null),
(6,'Hedisson Bilvård','hedisson','packad',1,2,'Saknar 2 st i lager, restnoteras'),
(7,'Autospa Uppsala','autospa','packad',2,19,null),
(8,'Däckproffsen AB','dackproffsen','packad',3,16,null),
(9,'Lackmästarna','lackmastarna','packad',4,13,'Kund vill hämta själv på lagret'),
(10,'Bilvårdshuset Malmö','bilvardshuset','packad',5,10,null),
(11,'Skinnvård Stockholm','skinnvard','skickad',6,7,null),
(12,'Fordonstvätt Öst','fordonstvatt','skickad',8,4,null),
(13,'Prestige Rekond','prestige','skickad',11,1,'Expressleverans, betald frakt'),
(14,'Bilvårdscenter Borås','boras','skickad',14,18,null),
(15,'Glansverkstan Örebro','glansverkstan','levererad',18,15,null),
(16,'Truckcare Sverige','truckcare','levererad',22,12,null),
(17,'Bilvård Direkt','bilvarddirekt','levererad',27,9,null),
(18,'Cityrekond Göteborg','cityrekond','levererad',35,6,'Fakturerad separat'),
(19,'Marina Bilvård','marina','levererad',46,3,null),
(20,'Norrlands Fordonsvård','norrlands','levererad',62,0,null)
)
insert into public.shop_orders (id, workshop_id, customer_user_id, customer_email, customer_name, customer_phone, status, total, internal_note, created_at, updated_at)
select ('11111111-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       '18a19c84-b2f0-4059-89d5-bd96127d0321',
       ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       slug||'@exempel.se', cname, '070-'||lpad((100+n)::text,3,'0')||' '||(10+n)||' '||(20+n),
       status, 0, note,
       now() - (days||' days')::interval - (hrs||' hours')::interval,
       now() - (days||' days')::interval - (hrs||' hours')::interval
from o;

with l(n,pid,pname,unit,price,qty) as (values
(1,'sipom-giove-skumschampo','Sipom GIOVE Skumschampo','5 L',395,4),
(1,'sipom-power-plus-s-alkalisk-avfettning','Sipom POWER PLUS/S Alkalisk avfettning','5 L',445,2),
(2,'malco-cw37-car-truck-wash','MALCO CW-37 Premium Car & Truck Wash','3,8 L',495,6),
(3,'rupes-lhr21iii-std-polermaskin','Rupes LHR21III/STD Polermaskin','styck',4995,1),
(3,'rupes-ulltrissa-bla-160','RUPES Ulltrissa Blå 160 mm','styck',245,4),
(4,'nasiol-neocoatx-keramiskt-lackskydd','Nasiol NeoCoatX Keramiskt Lackskydd','50 ml',1295,3),
(4,'nasiol-glasshield','Nasiol GlasShield','150 ml',495,2),
(5,'biltvattsvamp-gra','Biltvättsvamp Grå','styck',49,10),
(5,'malco-matthallare','Malco Matthållare','styck',195,4),
(6,'malco-complete-wheel-tire-cleaner','MALCO Complete Wheel & Tire Cleaner','3,8 L',385,3),
(6,'bug-off-insect-remover','Bug-Off Insect Remover','1 L',195,2),
(7,'elsea-dammsugare-vat-torr-2motor','ELSEA Dammsugare Våt & Torr 2-motor','styck',5495,1),
(8,'bead-bazooka-invento-12l','Bead Bazooka Chockluftare Invento 12 L','styck',4295,1),
(8,'vatskrapa-gron','Våtskrapa Grön','styck',79,3),
(9,'polermaskin-batteridriven-hlr21','Rupes HLR21 Batteridriven Polermaskin','styck',7495,1),
(9,'malco-epic-purple-foamed-wool-pad','MALCO EPIC Purple Foamed Wool Heavy Duty Pad 5,5"','styck',295,6),
(10,'malco-leather-conditioner-945','Malco Leather Conditioner','945 ml',295,5),
(10,'oxy-carpet-upholstery-cleaner','Oxy Carpet & Upholstery Cleaner','650 ml',265,3),
(11,'malco-leather-conditioner-945','Malco Leather Conditioner','945 ml',295,12),
(12,'sipom-luxor-avfettning','Sipom LUXOR Avfettning','5 L',425,8),
(12,'kallavfettning-v46','Kallavfettning V46','5 L',365,8),
(13,'nasiol-zr53-langvarigt-skydd','Nasiol ZR53 Långvarigt Skydd','50 ml',1495,4),
(13,'nasiol-nl272-nano-ceramic','Nasiol NL272 Nano Ceramic Coating','50 ml',1695,2),
(13,'malco-metal-polish','Malco Metal Polish','473 ml',225,3),
(14,'microfiber-twist-drying-towel-50x70','Microfiber TWIST Drying Towel 50×70','styck',149,20),
(14,'malco-tvatthink','Malco Tvätthink','styck',129,6),
(15,'polermaskin-lhr21v-std-kit','Rupes LHR21V Mark V Polermaskin STD-kit','styck',5795,1),
(16,'pax-hogtryckstvatt-200bar','PAX Högtryckstvätt 200 BAR','styck',12995,1),
(16,'sipom-power-plus-s-alkalisk-avfettning','Sipom POWER PLUS/S Alkalisk avfettning','5 L',445,10),
(17,'sipom-plastica-flower-fresh','Sipom Plastica Flower Fresh','5 L',315,6),
(17,'sipom-brill-3-plastglans','Sipom Brill 3 Plastglans','5 L',365,4),
(18,'rupes-lhr75e-mini-polermaskin','Rupes LHR75E Mini Polermaskin','styck',3695,1),
(18,'malco-rejuvenator-one-step','MALCO Rejuvenator One-Step Paint Restoration','946 ml',545,4),
(19,'nasiol-metalcoat-f2','Nasiol MetalCoat F2 Sprayable Ceramic Coating','250 ml',895,2),
(19,'munstycke-inkl-spridare-estro110','Munstycke inkl. spridare Estro110','styck',89,2),
(20,'kladseltvatt-hetvatten','Klädseltvätt Hetvatten','styck',14995,1),
(20,'malco-leather-conditioner-945','Malco Leather Conditioner','945 ml',295,4)
)
insert into public.shop_order_lines (order_id, product_id, name, unit, unit_price, quantity)
select ('11111111-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, pid, pname, unit, price, qty from l;

update public.shop_orders o set total = (
  select coalesce(sum(l.unit_price*l.quantity),0) from public.shop_order_lines l where l.order_id = o.id)
where o.id::text like '11111111-0000-4000-8000-%';

-- Historik: order lagd + varje statussteg fram till nuvarande status
insert into public.shop_order_events (order_id, workshop_id, actor_id, actor_name, type, to_status, created_at)
select o.id, o.workshop_id, o.customer_user_id, o.customer_name, 'created', 'mottagen', o.created_at
from public.shop_orders o where o.id::text like '11111111-0000-4000-8000-%';

insert into public.shop_order_events (order_id, workshop_id, actor_id, actor_name, type, from_status, to_status, created_at)
select o.id, o.workshop_id, '18a19c84-b2f0-4059-89d5-bd96127d0321', 'ferchichideni', 'status_changed',
       f.flow[s], f.flow[s+1], o.created_at + (s*6||' hours')::interval
from public.shop_orders o
cross join lateral (select array['mottagen','packad','skickad','levererad'] as flow) f
cross join lateral generate_series(1, array_position(f.flow, o.status)-1) as s
where o.id::text like '11111111-0000-4000-8000-%';

-- Några kommentarer, varav två taggar verkstadsägaren
with m(n,body,mentions,hrs) as (values
(3,'Kunden undrar om leveranstid. @[ferchichideni](18a19c84-b2f0-4059-89d5-bd96127d0321) kan du kolla?','{18a19c84-b2f0-4059-89d5-bd96127d0321}',2),
(6,'Restnoteringen är löst, allt finns på lagret nu.','{}',5),
(6,'@[ferchichideni](18a19c84-b2f0-4059-89d5-bd96127d0321) klart att skicka vidare.','{18a19c84-b2f0-4059-89d5-bd96127d0321}',4),
(9,'Kunden hämtar själv imorgon förmiddag.','{}',20),
(12,'Skickad med Schenker, 2 kolli.','{}',30),
(15,'Avslutad och fakturerad.','{}',50)
)
insert into public.workshop_messages (workshop_id, order_id, sender_id, sender_email, sender_name, body, mentions, created_at)
select '18a19c84-b2f0-4059-89d5-bd96127d0321',
       ('11111111-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       '22222222-0000-4000-8000-000000000001','anna@exempel.se','Anna Lindqvist',
       body, mentions::uuid[], now() - (hrs||' hours')::interval
from m;

insert into public.shop_order_events (order_id, workshop_id, actor_id, actor_name, type, detail, created_at)
select w.order_id, w.workshop_id, w.sender_id, w.sender_name, 'comment', left(w.body,120), w.created_at
from public.workshop_messages w
where w.sender_id = '22222222-0000-4000-8000-000000000001';
commit;

-- ── Betalstatus, leveransadress och frakt på demoordrarna ──────────────────
begin;
with d(n, pay, street, zip, city, carrier, track) as (values
(1,'obetald','Verkstadsgatan 12','431 37','Mölndal',null,null),
(2,'obetald','Hamnvägen 4','434 37','Kungsbacka',null,null),
(3,'fakturerad','Industrigatan 8','212 28','Malmö',null,null),
(4,'obetald','Backavägen 22','504 31','Borås',null,null),
(5,'betald','Motorvägen 3','702 27','Örebro',null,null),
(6,'betald','Bilvårdsvägen 9','421 32','Västra Frölunda',null,null),
(7,'fakturerad','Kungsgatan 44','753 21','Uppsala',null,null),
(8,'betald','Däckvägen 17','611 35','Nyköping',null,null),
(9,'obetald','Lackgatan 5','582 78','Linköping',null,null),
(10,'betald','Rekondvägen 2','215 32','Malmö',null,null),
(11,'betald','Skinnargatan 11','118 60','Stockholm','postnord','PN123456789SE'),
(12,'betald','Östra Industrivägen 6','602 28','Norrköping','schenker','SCH-99120045'),
(13,'fakturerad','Prestigevägen 1','182 33','Danderyd','dhl','DHL7788991234'),
(14,'betald','Lagergatan 30','506 30','Borås','postnord','PN987654321SE'),
(15,'betald','Glansvägen 7','703 62','Örebro','bring','BRG552104477'),
(16,'fakturerad','Truckgatan 25','931 57','Skellefteå','schenker','SCH-44870021'),
(17,'betald','Direktvägen 14','252 30','Helsingborg','postnord','PN551122334SE'),
(18,'betald','Rekondgatan 18','417 05','Göteborg','dhl','DHL5544332211'),
(19,'aterbetald','Marinvägen 9','452 30','Strömstad','budbee','BB77219940'),
(20,'betald','Norrlandsgatan 3','903 26','Umeå','egen',null)
)
update public.shop_orders o
set payment_status = d.pay,
    shipping_recipient = o.customer_name,
    shipping_street = d.street,
    shipping_postal_code = d.zip,
    shipping_city = d.city,
    shipping_country = 'Sverige',
    carrier = d.carrier,
    tracking_number = d.track
from d
where o.id = ('11111111-0000-4000-8000-'||lpad(d.n::text,12,'0'))::uuid;
commit;
