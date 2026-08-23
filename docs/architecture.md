# SwachhLens architecture

This is the source diagram for the implementation. The rendered companion is [`architecture.svg`](./architecture.svg).

```mermaid
flowchart LR
  citizen[Citizen on Expo app] -->|photo + campus + GPS| api[Express API]
  admin[Administrator in Expo app] -->|JWT-protected operations| api
  api --> auth[Auth and validation]
  api --> upload[Image upload storage]
  api --> vision[NVIDIA Vision API]
  vision --> normalize[Normalize category, volume, confidence, severity]
  normalize --> playbook[Waste playbook]
  playbook --> crew[Specialty crew matching + ETA]
  api --> duplicate[Campus duplicate consolidation]
  auth --> store[(JSON data store)]
  upload --> store
  duplicate --> store
  crew --> store
  admin -->|dashboard, assignment, status| store
  citizen -->|issue status and history| store
```

## Runtime boundaries

- `mobile/` is an Expo SDK 54 React Native client. It serves both citizen reporting and the administrator operations view.
- `backend/` is a TypeScript Express API. It owns authentication, validation, uploads, AI orchestration, playbook rules, crew assignment, ETA calculations, and persistence.
- `backend/data/` is the demo persistence layer. Writes use a temporary file and rename so JSON records are replaced atomically.
- `backend/uploads/` stores submitted images and is exposed only through the safe `/uploads/:filename` route.
- NVIDIA is the only remote vision provider. A deterministic local fallback keeps the demo usable without a key and marks the result for manual review.
