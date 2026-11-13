---
title: "Skill"
description: "ثبّت skill الخاصة بـ Defjs، واطلب عملية GET ذات أنواع، وتحقق من النتيجة وفق SDK المثبّت."
---

# Skill

يمنح skill الخاص بـ Defjs المساعدَ عقد تعريف SDK وتنفيذ التطبيق. يمكن للمساعد الداعم تحميله في المهمة المناسبة، أما التحميل التلقائي فيعتمد على الأداة.

## تثبيت skill [#install]

شغّل الأمر في المشروع الذي يجب أن يتلقى skill. تثبّتها أداة CLI في المشروع الحالي افتراضيًا، وقد تكتشف الوكيل الحالي أو تطلب اختياره؛ استخدم `-a` لتحديد وكيل صراحةً.

```sh
bunx skills add defjs/defjs --skill defjs
```

بعد النشر، يمكن قراءة تعليمات skill في [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md). مصدر GitHub هو الفرع الافتراضي وقد لا يطابق إصدار `@defjs/core` المثبّت في المشروع.

## اطلب عملية واحدة [#prompt]

أعطِ المساعد مهمة. يطلب هذا النص `GET /orders/:id` محدَّد الأنواع يبقى عميله في التطبيق:

```txt
Use @defjs/core to define GET /orders/:id.
The input is { id: number }; a successful response is { id: number, status: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## تحقق من النتيجة [#verify]

اقرأ التعريف والتطبيق كلًا على حدة. يصدّر التعريف العملية ولا ينشئ العميل. ينشئ التطبيق العميل ويستدعي العملية، مثل `getOrder(client, { id: 1 })`. حيث يُعلَن `input`، يكون `builder` دالة متزامنة نقية مكتوبة صراحة. تُستخدم قيمة النجاح فقط بعد أن يخلو موضع الخطأ: يفحص موضع الاستدعاء `if (err)` فور الاستدعاء ويخرج من الدالة من داخل تلك الكتلة، وتُرجع الدالة المساعدة التي قد تفشل مصفوفتها الخاصة `[err, value]` بدلًا من التسجيل أو إرجاع `undefined`.

ثم شغّل فحص الأنواع في ذلك المشروع والاختبارات التي تغطي العقد. يبقى تثبيت الاعتماديات وقواعد CI مع ذلك المشروع.
