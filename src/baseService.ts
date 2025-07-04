import * as qs from "qs";
import axios, {AxiosRequestConfig, AxiosResponse, AxiosInstance} from "axios";
import FormData from "form-data";
import {DataResolverFactory} from "./dataResolver";
import {HttpMethod} from "./constants";
import {HttpMethodOptions} from "./decorators";
import {isNode} from "./util";

axios.defaults.withCredentials = true;

export interface RequestConfig extends AxiosRequestConfig{
    extraMap?: Record<string, any>;
}

export interface Response<T = any> extends AxiosResponse<T> {
}

export type LogCallback = (config: RequestConfig, response: Response) => void;

const NON_HTTP_REQUEST_PROPERTY_NAME = "__nonHTTPRequestMethod__";

export const nonHTTPRequestMethod = (target: any, methodName: string) => {
    const descriptor = {
        value: true,
        writable: false,
    };
    Object.defineProperty(target[methodName], NON_HTTP_REQUEST_PROPERTY_NAME, descriptor);
};

export class BaseService {
    public __meta__: any;
    private _endpoint: string;
    private _httpClient: HttpClient;
    private _methodMap: Map<string, Function>;
    private _timeout: number;
    private _logCallback: LogCallback | null;

    constructor(serviceBuilder: ServiceBuilder) {
        this._endpoint = serviceBuilder.endpoint;
        this._httpClient = new HttpClient(serviceBuilder);
        this._methodMap = new Map<string, Function>();
        this._timeout = serviceBuilder.timeout;
        this._logCallback = serviceBuilder.logCallback;

        const methodNames = this._getInstanceMethodNames();
        methodNames.forEach((methodName) => {
            this._methodMap.set(methodName, (this as any)[methodName]);
        });

        const self = this;
        for (const methodName of methodNames) {
            const descriptor = {
                enumerable: true,
                configurable: true,
                get(): Function {
                    const method = self._methodMap.get(methodName);
                    if (!method) {
                        // Return a no-op function if method is undefined
                        return () => {};
                    }
                    const methodOriginalDescriptor = Object.getOwnPropertyDescriptor(method, NON_HTTP_REQUEST_PROPERTY_NAME);
                    if (methodOriginalDescriptor && methodOriginalDescriptor.value === true) {
                        return method;
                    }
                    if (methodName === "_logCallback") {
                        return method;
                    }
                    return (...args: any[]) => {
                        return self._wrap(methodName, args);
                    };
                },
                set: (newValue: any) => {
                    self._methodMap.set(methodName, newValue);
                },
            };
            Object.defineProperty(this, methodName, descriptor);
        }
    }

    @nonHTTPRequestMethod
    public isClientStandalone(): boolean {
        return this._httpClient.isStandalone();
    }

    @nonHTTPRequestMethod
    public useRequestInterceptor(interceptor: RequestInterceptorFunction): number {
        return this._httpClient.useRequestInterceptor(interceptor);
    }

    @nonHTTPRequestMethod
    public useResponseInterceptor(interceptor: ResponseInterceptorFunction): number {
        return this._httpClient.useResponseInterceptor(interceptor);
    }

    @nonHTTPRequestMethod
    public ejectRequestInterceptor(id: number): void {
        this._httpClient.ejectRequestInterceptor(id);
    }

    @nonHTTPRequestMethod
    public ejectResponseInterceptor(id: number): void {
        this._httpClient.ejectResponseInterceptor(id);
    }

    @nonHTTPRequestMethod
    public setEndpoint(endpoint: string): void {
        this._endpoint = endpoint;
    }

    @nonHTTPRequestMethod
    public setLogCallback(logCallback: LogCallback | null): void {
        this._logCallback = logCallback;
    }

    @nonHTTPRequestMethod
    public setTimeout(timeout: number): void {
        this._timeout = timeout;
    }

    @nonHTTPRequestMethod
    private _getInstanceMethodNames(): string[] {
        let properties: string[] = [];
        let obj = this;
        do {
            properties = properties.concat(Object.getOwnPropertyNames(obj));
            obj = Object.getPrototypeOf(obj);
        } while (obj);
        return properties.sort().filter((e, i, arr) => {
            return e !== arr[i + 1] && (this as any)[e] && typeof (this as any)[e] === "function";
        });
    }

    @nonHTTPRequestMethod
    private async _wrap(methodName: string, args: any[]): Promise<Response> {
        const {url, method, headers, query, data, signal, extraMap, onUploadProgress} = this._resolveParameters(methodName, args);

        const config = this._makeConfig(methodName, url, method, headers, query, data, signal, extraMap, onUploadProgress);
        let error;
        let response;
        try {
            response = await this._httpClient.sendRequest(config);
            // @ts-ignore
            if (response?.name === "AxiosError") {
                throw response;
            }

        } catch (err) {
            error = err;
            // @ts-ignore
            response = err.response;
        }
        if (this._logCallback) {
            this._logCallback(config, response);
        }
        if (error) {
            throw error;
        }
        return {...response, extraMap};
    }

    @nonHTTPRequestMethod
    private _resolveParameters(methodName: string, args: any[]): any {
        const url = this._resolveUrl(methodName, args);
        const method = this._resolveHttpMethod(methodName);
        let headers = this._resolveHeaders(methodName, args);
        const query = this._resolveQuery(methodName, args);
        const data = this._resolveData(methodName, headers, args);
        const onUploadProgress = this._resolveOnUploadProgress(methodName, args);

        const signal = this._resolveSignal(methodName, args);
        const extraMap = this._resolveExtraMap(methodName, args);
        if (headers["content-type"] && headers["content-type"].indexOf("multipart/form-data") !== -1 && isNode) {
            headers = {...headers, ...(data as FormData).getHeaders()};
        }
        return {url, method, headers, query, data, signal, extraMap, onUploadProgress};
    }

    @nonHTTPRequestMethod
    private _makeConfig(methodName: string, url: string, method: HttpMethod, headers: any, query: any, data: any, signal: any, extraMap: any, onUploadProgress: any)
        : RequestConfig {
        let config: RequestConfig = {
            url,
            method,
            headers,
            params: query,
            data,
            extraMap,
            onUploadProgress,
        };
        // response type
        if (this.__meta__[methodName].responseType) {
            config.responseType = this.__meta__[methodName].responseType;
        }
        // request transformer
        if (this.__meta__[methodName].requestTransformer) {
            config.transformRequest = this.__meta__[methodName].requestTransformer;
        }
        // response transformer
        if (this.__meta__[methodName].responseTransformer) {
            config.transformResponse = this.__meta__[methodName].responseTransformer;
        }
        // timeout
        config.timeout = this.__meta__[methodName].timeout || this._timeout;

        // deprecated
        if (this.__meta__[methodName].deprecated) {
            let hint = `[warning] Deprecated method: "${methodName}". `;
            if (this.__meta__[methodName].deprecatedHint) {
                hint += this.__meta__[methodName].deprecatedHint;
            }
            // tslint:disable-next-line:no-console
            console.warn(hint);
        }
        // query array format
        if (this.__meta__[methodName].queryArrayFormat) {
            config.paramsSerializer = (params: any): string => {
                return qs.stringify(params, { arrayFormat: this.__meta__[methodName].queryArrayFormat});
            };
        }

        if (this.__meta__[methodName].onUploadProgress) {
            config.onUploadProgress = this.__meta__[methodName].onUploadProgress;
        }

        // mix in config set by @Config
        config = {
            ...config,
            ...this.__meta__[methodName].config,
        };
        return config;
    }

    @nonHTTPRequestMethod
    private _resolveUrl(methodName: string, args: any[]): string {
        const meta = this.__meta__;
        const endpoint = this._endpoint;
        const basePath = meta.basePath;
        const path = meta[methodName].path;
        const pathParams = meta[methodName].pathParams;
        const options = meta[methodName].options || {};
        let url = this.makeURL(endpoint, basePath, path, options);
        for (const pos in pathParams as Record<string, any>) {
            if ((pathParams as Record<string, any>)[pos]) {
                url = url.replace(new RegExp(`\{${(pathParams as Record<string, any>)[pos]}}`), (args as Record<string, any>)[pos]);
            }
        }
        return url;
    }

    @nonHTTPRequestMethod
    private makeURL(endpoint: string, basePath: string, path: string, options: HttpMethodOptions): string {
        const isAbsoluteURL = /^([a-z][a-z\d\+\-\.]*:)?\/\//i.test(path);
        if (isAbsoluteURL) {
            return path;
        }
        if (options.ignoreBasePath) {
            return [endpoint, path].join("");
        }
        return [endpoint, basePath, path].join("");
    }

    @nonHTTPRequestMethod
    private _resolveHttpMethod(methodName: string): HttpMethod {
        const meta = this.__meta__;
        return meta[methodName].method;
    }

    @nonHTTPRequestMethod
    private _resolveHeaders(methodName: string, args: any[]): any {
        const meta = this.__meta__;
        const headers = meta[methodName].headers || {};
        const headerParams = meta[methodName].headerParams;
        for (const pos in headerParams as Record<string, any>) {
            if ((headerParams as Record<string, any>)[pos]) {
                (headers as Record<string, any>)[(headerParams as Record<string, any>)[pos]] = (args as Record<string, any>)[pos];
            }
        }
        const headerMapIndex = meta[methodName].headerMapIndex;
        if (headerMapIndex >= 0) {
            for (const key in (args[headerMapIndex] as Record<string, any>)) {
                if ((args[headerMapIndex] as Record<string, any>)[key]) {
                    (headers as Record<string, any>)[key] = (args[headerMapIndex] as Record<string, any>)[key];
                }
            }
        }
        return headers;
    }

    @nonHTTPRequestMethod
    private _resolveQuery(methodName: string, args: any[]): any {
        const meta = this.__meta__;
        const query = meta[methodName].query || {};
        const queryParams = meta[methodName].queryParams;
        for (const pos in queryParams as Record<string, any>) {
            if ((queryParams as Record<string, any>)[pos] !== undefined && (queryParams as Record<string, any>)[pos] !== null) {
                (query as Record<string, any>)[(queryParams as Record<string, any>)[pos]] = (args as Record<string, any>)[pos];
            }
        }
        const queryMapIndex = meta[methodName].queryMapIndex;
        if (queryMapIndex >= 0) {
            for (const key in (args[queryMapIndex] as Record<string, any>)) {
                if ((args[queryMapIndex] as Record<string, any>)[key] !== undefined && (args[queryMapIndex] as Record<string, any>)[key] !== null) {
                    (query as Record<string, any>)[key] = (args[queryMapIndex] as Record<string, any>)[key];
                }
            }
        }
        return query;
    }

    @nonHTTPRequestMethod
    private _resolveSignal(methodName: string, args: any[]): any {
        const meta = this.__meta__;
        const signalIndex = meta[methodName]?.signalIndex || {};
        if (signalIndex >= 0) {
            return args[signalIndex];
        }
        return null;
    }

    @nonHTTPRequestMethod
    private _resolveExtraMap(methodName: string, args: any[]): any {
        const meta = this.__meta__;
        const extraMapIndex = meta[methodName]?.extraMapIndex || {};
        if (extraMapIndex >= 0) {
            return args[extraMapIndex];
        }
        return null;
    }

    @nonHTTPRequestMethod
    private _resolveOnUploadProgress(methodName: string, args: any[]): any {
        const meta = this.__meta__;
        const onUploadProgressIndex = meta[methodName]?.onUploadProgressIndex ?? {};
        if (onUploadProgressIndex > 0) {
            return args[onUploadProgressIndex];
        }
        return null;
    }

    @nonHTTPRequestMethod
    private _resolveData(methodName: string, headers: any, args: any[]): any {
        const meta = this.__meta__;
        const bodyIndex = meta[methodName].bodyIndex;
        const fields = meta[methodName].fields || {};
        const parts = meta[methodName].parts || {};
        const fieldMapIndex = meta[methodName].fieldMapIndex;
        const gqlQuery = meta[methodName].gqlQuery;
        const gqlOperationName = meta[methodName].gqlOperationName;
        const gqlVariablesIndex = meta[methodName].gqlVariablesIndex;


        let data: any = {};

        // @Body
        if (bodyIndex >= 0) {
            if (Array.isArray(args[bodyIndex])) {
                data = args[bodyIndex];
            } else {
                data = {...(data as Record<string, any>), ...(args[bodyIndex] as Record<string, any>)};
            }
        }

        // @Field
        if (Object.keys(fields as Record<string, any>).length > 0) {
            const reqData: Record<string, any> = {};
            for (const pos in fields as Record<string, any>) {
                if ((fields as Record<string, any>)[pos]) {
                    reqData[(fields as Record<string, any>)[pos]] = (args as Record<string, any>)[pos];
                }
            }
            data = {...(data as Record<string, any>), ...reqData};
        }

        // @FieldMap
        if (fieldMapIndex >= 0) {
            const reqData: Record<string, any> = {};
            for (const key in (args[fieldMapIndex] as Record<string, any>)) {
                if ((args[fieldMapIndex] as Record<string, any>)[key]) {
                    reqData[key] = (args[fieldMapIndex] as Record<string, any>)[key];
                }
            }
            data = {...(data as Record<string, any>), ...reqData};
        }

        // @MultiPart
        if (Object.keys(parts as Record<string, any>).length > 0) {
            const reqData: Record<string, any> = {};
            for (const pos in parts as Record<string, any>) {
                if ((parts as Record<string, any>)[pos]) {
                    reqData[(parts as Record<string, any>)[pos]] = (args as Record<string, any>)[pos];
                }
            }
            data = {...(data as Record<string, any>), ...reqData};
        }

        // @GraphQL
        if (gqlQuery) {
            data.query = gqlQuery;
            if (gqlOperationName) {
                data.operationName = gqlOperationName;
            }
            // @GraphQLVariables
            if (gqlVariablesIndex >= 0) {
                data.variables = args[gqlVariablesIndex];
            }
        }


        const contentType = headers["content-type"] || "application/json";
        const dataResolverFactory = new DataResolverFactory();
        const dataResolver = dataResolverFactory.createDataResolver(contentType);
        return dataResolver.resolve(headers, data);
    }
}

export type RequestInterceptorFunction =
    (value: AxiosRequestConfig) => AxiosRequestConfig | Promise<AxiosRequestConfig>;
export type ResponseInterceptorFunction<T = any> =
    (value: AxiosResponse<T>) => AxiosResponse<T> | Promise<AxiosResponse<T>>;

abstract class BaseInterceptor {
    public onRejected(error: any) {
        return;
    }
}

export abstract class RequestInterceptor extends BaseInterceptor {
    public abstract onFulfilled(value: AxiosRequestConfig): AxiosRequestConfig | Promise<AxiosRequestConfig>;
}

export abstract class ResponseInterceptor<T = any> extends BaseInterceptor {
    public abstract onFulfilled(value: AxiosResponse<T>): AxiosResponse<T> | Promise<AxiosResponse<T>>;
}

export class ServiceBuilder {
    private _endpoint: string = "";
    private _standalone: boolean | AxiosInstance = false;
    private _requestInterceptors: Array<RequestInterceptorFunction | RequestInterceptor> = [];
    private _responseInterceptors: Array<ResponseInterceptorFunction | ResponseInterceptor> = [];
    private _timeout: number = 60000;
    private _logCallback: LogCallback | null = null;

    public build<T>(service: new (builder: ServiceBuilder) => T): T {
        return new service(this);
    }

    public setEndpoint(endpoint: string): ServiceBuilder {
        this._endpoint = endpoint;
        return this;
    }

    // 单例模式
    public setStandalone(standalone: boolean | AxiosInstance): ServiceBuilder {
        this._standalone = standalone;
        return this;
    }

    // 插入请求拦截器
    public setRequestInterceptors(...interceptors: Array<RequestInterceptorFunction | RequestInterceptor>)
        : ServiceBuilder {
        this._requestInterceptors.push(...interceptors);
        return this;
    }

    // 插入应答拦截器
    public setResponseInterceptors(...interceptors: Array<ResponseInterceptorFunction | ResponseInterceptor>)
        : ServiceBuilder {
        this._responseInterceptors.push(...interceptors);
        return this;
    }

    public setTimeout(timeout: number): ServiceBuilder {
        this._timeout = timeout;
        return this;
    }

    public setLogCallback(logCallback: LogCallback): ServiceBuilder {
        this._logCallback = logCallback;
        return this;
    }

    get endpoint(): string {
        return this._endpoint;
    }

    get standalone(): boolean | AxiosInstance {
        return this._standalone;
    }

    get requestInterceptors(): Array<RequestInterceptorFunction | RequestInterceptor> {
        return this._requestInterceptors;
    }

    get responseInterceptors(): Array<ResponseInterceptorFunction | ResponseInterceptor> {
        return this._responseInterceptors;
    }

    get timeout(): number {
        return this._timeout;
    }

    get logCallback(): LogCallback | null {
        return this._logCallback;
    }
}

class HttpClient {
    private axios: AxiosInstance = axios;
    private standalone: boolean = false;

    constructor(builder: ServiceBuilder) {
        if (builder.standalone === true) {
            this.axios = axios.create();
            this.standalone = true;
        } else if (typeof builder.standalone === "function") {
            this.axios = builder.standalone;
        }

        builder.requestInterceptors.forEach((interceptor) => {
            if (interceptor instanceof RequestInterceptor) {
                this.axios.interceptors.request.use(
                    interceptor.onFulfilled.bind(interceptor) as any,
                    interceptor.onRejected.bind(interceptor),
                );
            } else {
                this.axios.interceptors.request.use(interceptor as any);
            }
        });

        builder.responseInterceptors.forEach((interceptor) => {
            if (interceptor instanceof ResponseInterceptor) {
                this.axios.interceptors.response.use(
                    interceptor.onFulfilled.bind(interceptor),
                    interceptor.onRejected.bind(interceptor),
                );
            } else {
                this.axios.interceptors.response.use(interceptor);
            }
        });
    }

    public isStandalone(): boolean {
        return this.standalone;
    }

    public async sendRequest(config: RequestConfig): Promise<Response> {
        return this.axios(config);
    }

    public useRequestInterceptor(interceptor: RequestInterceptorFunction): number {
        return this.axios.interceptors.request.use(interceptor as any);
    }

    public useResponseInterceptor(interceptor: ResponseInterceptorFunction): number {
        return this.axios.interceptors.response.use(interceptor);
    }

    public ejectRequestInterceptor(id: number): void {
        this.axios.interceptors.request.eject(id);
    }

    public ejectResponseInterceptor(id: number): void {
        this.axios.interceptors.response.eject(id);
    }
}
