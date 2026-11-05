---
title: "تصميم SDK"
description: صمّم العمليات وStructs والحزم بحيث تصف عقدًا دون امتلاك عميل تطبيق.
---

## عملية واحدة لكل تعريف [#one-operation]

أعطِ كل عملية تعريفها ووحدتها الخاصة. فللعملية طريقة واحدة وشكل مسار واحد ومدخل واحد وعقد مخرج واحد. التقسيم حسب العملية يُبقي العقد مقروءًا ويتيح للتطبيق استيراد العمليات التي يستدعيها فقط.

فضّل:

```ts
export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  operation: "orders.read",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});
```

تجنّب وحدة تنشئ عميلًا أو تخزّن نقطة نهاية بجوار التعريفات.

## اقرن المدخل بـ builder صريح [#builder]

أعلن كل قيمة يوفّرها المستدعي في `input` وضعها في `builder`. لا تعتمد على تطابق اسم حقل مع معامل مسار. `builder` متزامن ونقي: يجوز له إعادة تشكيل القيم، لكنه يجب ألا يقرأ بيانات اعتماد، ولا يستدعي الشبكة، ولا يغيّر حالة مشتركة.

```ts
const updateOrder = defineRequest({
  method: "PATCH",
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    requestId: struct.string(),
    profile: struct.object({ name: struct.string() }),
  }),
  builder: (input) => ({
    path: { id: input.id },
    headers: { "x-request-id": input.requestId },
    body: input.profile,
  }),
});
```

## تصف Structs شكل السلك [#structs]

استخدم Struct للبيانات التي تعبر السلك. واستخدم alias عندما يختلف اسم السلك عن اسم TypeScript. واعتبر قواعد العمل والتحقق بين الحقول والتطبيع سياسة تطبيق، لا سلوك Struct.

```ts
const profile = struct.object({
  customerName: struct.string().alias("customer_name"),
});
```

## استخدم اسم عملية مستقرًا [#operation-name]

اضبط `operation` على هوية منخفضة التنوّع مثل `orders.read`. فهي تسم القياس عن بُعد والتشخيص دون أن تحمل عنوان URL أو مدخل المستخدم أو قيمة خاصة بطلب.

## أبقِ SDK خاليًا من حالة التنفيذ [#no-client]

تصدّر حزمة SDK التعريفات وStructs والأنواع. وهي لا تستدعي `createClient`، ولا تحتفظ بعميل مفرد، ولا تقرأ متغيرات البيئة. فالتطبيق يقرر نقطة النهاية وبيانات الاعتماد.

## أعطِ العقد إصدارات بوعي [#versioning]

اعتبرها تغييرات كاسرة: حقلًا محذوفًا، أو طريقة أو مسارًا متغيّرًا، أو مدخلًا أُضيق. والإضافات متوافقة عادة. أبقِ نطاق `peer` في الحزمة صادقًا، وانشر بنص التعريف نفسه الذي يترجم إليه التطبيق، وسجّل وسم الإصدار للحزمة المنشورة.
