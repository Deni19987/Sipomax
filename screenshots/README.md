# Produktbilder

Bilder av appen för demo och säljmaterial, i två format:

- `mobil/` — 390×844 @3x (iPhone-format). Appen är byggd mobilt först, så det
  här är formatet som visar produkten bäst.
- `desktop/` — 1440×900 @2x. Appskalet är låst till `max-w-md`
  (`src/components/shop/ShopShell.tsx`), så på en bredare skärm renderas appen
  som en centrerad kolumn i telefonbredd.

Filnamnen är numrerade i den ordning de är tänkta att visas:
`0x` inloggning, `1x` butiken (kundens vy), `2x` verkstaden (din vy).

## Ta nya bilder

```sh
npm run dev                                        # i en egen terminal
PW_EMAIL=... PW_PASSWORD=... npm run screenshots
```

Kundvyn kan fotograferas med ett eget konto:

```sh
PW_EMAIL=... PW_PASSWORD=... \
PW_CUSTOMER_EMAIL=... PW_CUSTOMER_PASSWORD=... npm run screenshots
```

Sätt `PW_BASE_URL=https://sipomax.se` för att fotografera driftsatt app i
stället för den lokala dev-servern. Lösenord läses bara från miljövariabler —
lägg dem aldrig i repot.
