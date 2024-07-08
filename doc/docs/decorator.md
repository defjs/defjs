# Decorator

### 示例

```typescript
import { Method, Header, Body } from "@runyang/rest-client-kit";

@Method("GET", "/v1/users")
class ListUserInput {
  @Header("X-Content-Type") type: string = "test-header";
  @Header() authentication: string = "0123456789";

  @Body("type") userType: number = 0;
  @Body() keyword: string = "0123456789";
}
```

### Method

`Method` 装饰器可以自定义请求方法，同时也提供了基本的 `Get` `Post` `Delete` `Head` `Put` `Patch` `Option`

### Header

### Body
