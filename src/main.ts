import * as certServer from "./certServer.ts";
import * as fake from "./fakeServer.ts";
import * as proxy from "./proxy.ts";

certServer.start();
fake.start();
proxy.start();

