/* global jest describe it expect beforeEach */

jest.mock('@aws-sdk/client-lambda', () => {
	const send = jest.fn(() => Promise.resolve({ StatusCode: 200 }));
	const LambdaClient = jest.fn(() => ({ send }));
	const InvokeCommand = jest.fn((input) => ({ input }));
	return { LambdaClient, InvokeCommand, __send: send };
});

const { LambdaClient, InvokeCommand, __send: send } = require('@aws-sdk/client-lambda');
const WarmUp = require('../src/index');
const { getServerlessConfig, getPluginUtils } = require('./utils/configUtils');

// osls 4 removed provider.request() and offers provider.getAwsSdkV3Config() instead
const getOsls4Serverless = (custom, { request, getAwsSdkV3Config }) =>
	getServerlessConfig({
		getProvider: () => ({
			request,
			getAwsSdkV3Config,
			getStage: () => 'dev',
			getRegion: () => 'us-east-1',
		}),
		service: {
			custom,
			functions: { someFunc1: { name: 'someFunc1' }, someFunc2: { name: 'someFunc2' } },
		},
	});

describe('Serverless warmup plugin warmup:prewarm:start hook on osls 4', () => {
	beforeEach(() => {
		LambdaClient.mockClear();
		InvokeCommand.mockClear();
		send.mockClear();
	});

	it('Should prewarm through an SDK v3 client built from the framework AWS config', async () => {
		const request = jest.fn(() => Promise.resolve());
		const awsConfig = { region: 'eu-west-1', credentials: () => Promise.resolve({}) };
		const getAwsSdkV3Config = jest.fn(() => Promise.resolve(awsConfig));
		const serverless = getOsls4Serverless(
			{ warmup: { default: { enabled: true, prewarm: true } } },
			{ request, getAwsSdkV3Config },
		);
		const plugin = new WarmUp(serverless, {}, getPluginUtils());

		await plugin.hooks['before:warmup:prewarm:start']();
		await plugin.hooks['warmup:prewarm:start']();

		expect(request).not.toHaveBeenCalled();
		expect(LambdaClient).toHaveBeenCalledTimes(1);
		expect(LambdaClient).toHaveBeenCalledWith(awsConfig);
		expect(send).toHaveBeenCalledTimes(1);
		expect(InvokeCommand).toHaveBeenCalledWith({
			FunctionName: 'warmup-test-dev-warmup-plugin-default',
			InvocationType: 'RequestResponse',
			LogType: 'None',
			Qualifier: undefined,
			Payload: Buffer.from('{"source":"serverless-plugin-warmup"}'),
		});
	});

	it('Should build the Lambda client once and reuse it across warmers', async () => {
		const getAwsSdkV3Config = jest.fn(() => Promise.resolve({ region: 'eu-west-1' }));
		const serverless = getOsls4Serverless(
			{
				warmup: {
					default: { enabled: true, prewarm: true },
					secondary: { enabled: true, prewarm: true },
				},
			},
			{ request: jest.fn(), getAwsSdkV3Config },
		);
		const plugin = new WarmUp(serverless, {}, getPluginUtils());

		await plugin.hooks['before:warmup:prewarm:start']();
		await plugin.hooks['warmup:prewarm:start']();

		expect(getAwsSdkV3Config).toHaveBeenCalledTimes(1);
		expect(LambdaClient).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledTimes(2);
	});

	it('Should keep using provider.request when the framework has no SDK v3 config (osls 3)', async () => {
		const request = jest.fn(() => Promise.resolve());
		const serverless = getOsls4Serverless(
			{ warmup: { default: { enabled: true, prewarm: true } } },
			{ request, getAwsSdkV3Config: undefined },
		);
		const plugin = new WarmUp(serverless, {}, getPluginUtils());

		await plugin.hooks['before:warmup:prewarm:start']();
		await plugin.hooks['warmup:prewarm:start']();

		expect(request).toHaveBeenCalledTimes(1);
		expect(LambdaClient).not.toHaveBeenCalled();
	});
});
