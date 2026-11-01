---
title: "الدليل"
description: صمّم عقود SDK وعملياته، وانشرها، واضبط التنفيذ في التطبيقات المستهلكة.
---

يفصل Defjs بين واجهة API التي ينشرها الفريق والعميل الذي يستخدمه التطبيق. اتبع مسار تأليف SDK لتعريف العمليات وتغليفها؛ واتبع مسار التطبيق لضبط التنفيذ ومعالجة النتائج.

## تطوير SDK [#getting-started]

- [نظرة عامة على المشروع](/ar)
- [البدء السريع](/ar/docs/start)
- [بناء SDK ونشره](/ar/recipes/publish-http-sdk)
- [لماذا التعريف والتنفيذ منفصلان](/ar/docs/design-decisions)

## العقود والتنفيذ [#calls-and-contracts]

يملك مؤلفو SDK الـ Structs وتعريفات نقاط النهاية. توفّر التطبيقات العميل وتستدعي العمليات به.

- [عقود البيانات / Struct](/ar/docs/struct)
- [إعداد العميل / Client](/ar/docs/client)

## الطلبات والزمن الحقيقي

- [طلبات HTTP](/ar/docs/http)
- [تدفقات أحداث SSE](/ar/docs/sse)
- [جلسات WebSocket](/ar/docs/web-socket)

## الأخطاء والاعتراض

- [معالجة الأخطاء](/ar/docs/errors)
- [المعترضات](/ar/docs/interceptors)

## الإضافات

حزم اختيارية لعميل التطبيق المستهلك. تبقى تعريفات SDK مستقلة عنها.

- [الإضافات](/ar/docs/integrations)
- [React](/ar/docs/integrations/react)
- [Vue](/ar/docs/integrations/vue)
- [خادم OpenTelemetry](/ar/docs/integrations/opentelemetry-server)

## الذكاء الاصطناعي

- [التطوير بمساعدة الذكاء الاصطناعي](/ar/docs/ai)
- [استدعاء واجهات الذكاء الاصطناعي](/ar/docs/ai-api)

[قرارات التصميم](/ar/docs/design-decisions)
