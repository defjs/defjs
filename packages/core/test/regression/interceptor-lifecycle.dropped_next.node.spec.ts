import {
  registerInterceptorDroppedNextSuite,
  subscribeProcessRejections,
} from "../suites/interceptor-dropped-next.ts";

registerInterceptorDroppedNextSuite(subscribeProcessRejections);
