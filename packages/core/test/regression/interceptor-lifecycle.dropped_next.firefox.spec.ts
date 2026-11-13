import {
  registerInterceptorDroppedNextSuite,
  subscribeWindowRejections,
} from "../suites/interceptor-dropped-next.ts";

registerInterceptorDroppedNextSuite(subscribeWindowRejections);
