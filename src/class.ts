import './libs/WebpackEnvRunner';

import parseUrl from 'parseuri';
import QueryString from 'query-string';
import matchAll from './libs/RegexMatchAll';
import Base64 from './libs/Base64Provider';

import { RequestHeaders, StringKeyStringValue } from '../types/headers';

import HttpVersions from './enums/httpVersions';
import RequestMethods from './enums/methods';
import Encodings from './enums/encodings';
import {
  GenerateFunctionArgs,
  HttpRequestParameters,
  HttpResponseData,
  TypeStringBuffer,
} from '../types/arguments';
import {
  Authentication,
  AuthenticationCredentials,
  AuthenticationData,
  AuthenticationToken,
} from '../types/auth';
import AuthTypes from './enums/auth';

const { atob } = Base64;

const { parseUrl: parseQuery } = QueryString;

class HttpPacket {
  Static = HttpPacket;

  auth: Authentication;

  version: string = HttpVersions.v1_1;

  host: string = 'NULL_HOST';

  path: string = 'NULL_PATH';

  method: string = RequestMethods.Get;

  encoding: Encodings = Encodings.TextPlain;

  query: object = {};

  headers: RequestHeaders;

  body?: object | string;

  constructor({
    authentication,
    version,
    method,
    url,
    queryParams,
    headers,
    body,
  }: HttpRequestParameters) {
    const linkParsed = parseQuery(url);

    const urlQuery = linkParsed.query;
    const urlParsed = parseUrl(linkParsed.url);

    // Auth header data
    if (authentication) {
      this.auth = authentication;
    }

    // Version parameter
    if (version) {
      this.version = version;
    }

    // Populating METHOD
    if (method) {
      this.method = method;
    }

    // Populating HOST and PATH
    this.host = urlParsed.host;
    this.path = urlParsed.path || '/';

    // Populating QUERY object
    Object.assign(this.query, {
      ...urlQuery,
      ...queryParams,
    });

    // Populating ENCODING and BODY
    if (typeof body === 'object') {
      this.encoding = body.encoding;
      this.body = body.content;
    }

    // Populating HEADERS object
    this.headers = { Host: this.host };

    if (this.body) {
      this.headers.ContentType = this.encoding;
    }

    this.headers = Object.assign(this.headers, headers);
  }

  #outRequestLine = (): string => {
    const {
      method,
      path,
      query,
      version,
    } = this;

    const isQueryParamsEmpty = (Object.keys(query).length);
    const stringQueryParams = (isQueryParamsEmpty)
      ? `?${this.#urlencodeParameters(query)}`
      : '';

    const methodUpCase = method.toUpperCase();
    const pathAndQuery = `${path}${stringQueryParams}`;
    const httpVersion = `HTTP/${version}`;

    return `${methodUpCase} ${pathAndQuery} ${httpVersion}`;
  };

  #outHeaders = (): Array<string> => {
    // Cloning headers
    const headers = { ...this.headers };

    // Setting Authorization header params
    if (this.auth) {
      headers.Authorization = HttpPacket.processAuthData(this.auth.type, this.auth.credentials);
    }

    const headerNames = Object.keys(headers);
    const headersArray: Array<string> = [];

    headerNames.forEach((headerName) => {
      const isCamelConvertionNeeded = (headerName[0] !== '_');

      const HeaderName = (isCamelConvertionNeeded)
        ? this.#convertHeaderName(headerName)
        : headerName.slice(1);
      const HeaderValue = headers[headerName];

      headersArray.push(`${HeaderName}: ${HeaderValue}`);
    });

    return headersArray;
  };

  #convertHeaderName = (camelHeaderName: string): string => {
    const CapitalSeparator = /([A-Z][a-z]+)/g;

    const headersParts = <RegExpMatchArray> camelHeaderName.match(CapitalSeparator);

    return headersParts.join('-');
  };

  #urlencodeParameters = (obj: object): string => {
    const keys = Object.keys(obj);
    const values = Object.values(obj);

    let urlencoded = Object.values(keys);

    urlencoded = urlencoded.map((key: string, i) => {
      const value = values[i];

      return `${key}=${value}`;
    });

    return urlencoded.join('&');
  };

  #encodeBody = (): string => {
    const { encoding, body = '' } = this;

    let encodedBody: string;

    switch (encoding) {
      case Encodings.FormData:
        throw Error('FormData currently not supported');
      case Encodings.FormUrlencoded:
        encodedBody = this.#urlencodeParameters(<object> body);
        break;
      case Encodings.Json:
        encodedBody = JSON.stringify(<object> body);
        break;
      case Encodings.TextPlain:
        encodedBody = <string> body;
        break;
      default:
        throw Error(`Unsupported body content encoding ${encoding}`);
    }

    return encodedBody;
  };

  private static convertStringToBytes = (strReq: string): Uint8Array => {
    const array = strReq
      .split('')
      .map((letter) => (
        letter.charCodeAt(0)
      ));

    return Uint8Array.from(array);
  };

  private static convertBytesToString = (bytesRes: Uint8Array): string => {
    let str = '';
    bytesRes.forEach((byte) => {
      str += String.fromCharCode(byte);
    });

    return str;
  };

  private static processAuthData(type: AuthTypes, data: AuthenticationData) {
    function processBasic(credentials: AuthenticationCredentials) {
      const rawData = `${credentials.username}:${credentials.password}`;
      const baseData = atob(rawData);

      return `Basic ${baseData}`;
    }
    function processBearer(tokenData: AuthenticationToken) {
      return `Bearer ${tokenData.token}`;
    }

    switch (type) {
      case AuthTypes.Basic:
        return processBasic(<AuthenticationCredentials> data);
      case AuthTypes.Bearer:
        return processBearer(<AuthenticationToken> data);
      default:
        break;
    }

    throw new Error('Authentication header preparation failed');
  }

  generate(type: GenerateFunctionArgs = 'string'): TypeStringBuffer {
    const ReqLine = this.#outRequestLine();
    const Headers = this.#outHeaders();

    const Body = this.#encodeBody();

    if (Body.length) {
      Headers.push(`Content-Length: ${Body.length}`);
    }

    const merged = [
      ReqLine,
      ...Headers,
      `\r\n${Body}`,
    ];

    const strRequest = merged.join('\r\n');

    if (type === 'buffer') {
      return this.Static.convertStringToBytes(strRequest);
    }

    return strRequest;
  }

  static parse(request: TypeStringBuffer): HttpResponseData {
    const Static = HttpPacket;

    let strReq: string;

    // Checking if is something else than string
    if (typeof request !== 'string') {
      strReq = Static.convertBytesToString(request);
    } else {
      strReq = request;
    }

    // Replacing CRLF to LF as some servers using it
    strReq = strReq.replace(/\r\n/g, '\n');

    const parts = strReq.split(/\n{2}/mg);
    const head = parts.splice(0, 1)[0];
    const content = parts.join('\n\n');

    const regexResLine = /HTTP\/(?<httpVersion>\d\.\d)\s(?<statusCode>\d+)\s(?<statusDescription>.*)/mg;
    const regexHeader = /(?<name>.*):\s(?<value>.*)/m;
    // const regexBody = /\n{2}(.?\n?)*/mg;

    const resLine = regexResLine.exec(<string> head).groups;

    const headers: StringKeyStringValue = {};

    matchAll(regexHeader, <string> head)
      .forEach((match) => {
        const headerName = match.groups.name;

        headers[headerName] = match.groups.value;
      });

    const body = content;

    return {
      version: resLine.httpVersion,
      status: {
        code: Number.parseInt(resLine.statusCode, 10),
        description: resLine.statusDescription,
      },
      headers,
      body,
    };
  }
}

export default HttpPacket;
