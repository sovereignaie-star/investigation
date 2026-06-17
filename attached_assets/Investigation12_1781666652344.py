investigation-room/
├── package.json
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
├── postcss.config.js
├── .env.local                    ← ضع مفاتيح API هنا
├── public/
│   └── favicon.ico
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx              ← غرفة القيادة
    │   └── investigate/
    │       └── page.tsx          ← غرفة التحري
    ├── components/
    │   ├── CommandCenter/
    │   │   ├── MainPanel.tsx
    │   │   └── InvestigateButton.tsx
    │   └── InvestigationRoom/
    │       ├── SearchBar.tsx
    │       ├── InfiniteCanvas.tsx
    │       ├── ApiKeySettings.tsx
    │       ├── InvestigationStats.tsx
    │       ├── SavedInvestigations.tsx
    │       └── ResultNodes/
    │           ├── VideoNode.tsx
    │           ├── MapNode.tsx
    │           ├── ImageNode.tsx
    │           ├── FileNode.tsx
    │           ├── LinkNode.tsx
    │           ├── LocationNode.tsx
    │           ├── TextNode.tsx
    │           └── DefaultNode.tsx
    ├── store/
    │   └── investigationStore.ts
    ├── utils/
    │   ├── identifierList.ts     ← 700 معرف
    │   ├── resultFetcher.ts      ← استراتيجيات الجلب
    │   ├── smartInvestigator.ts  ← المحقق الذكي (الربط)
    │   ├── apiKeyManager.ts      ← إدارة المفاتيح
    │   └── investigationDatabase.ts ← التخزين
    └── types/
        └── index.ts
