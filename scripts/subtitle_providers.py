"""Gemini/Groq text comparison adapters. Keys travel in headers only."""
import json
import time
import urllib.error
import urllib.request

MODELS = {'groq': 'openai/gpt-oss-120b', 'gemini': 'gemini-3.5-flash-lite'}
KEY_NAMES = {'groq': 'GROQ_API_KEY', 'gemini': 'GEMINI_API_KEY'}


class ProviderError(RuntimeError):
    def __init__(self, provider, status, code=None, retry_after=None):
        self.provider, self.status, self.code = provider, status, code
        self.retry_after = retry_after
        super().__init__(f'{provider}: HTTP {status}' + (f' ({code})' if code else ''))


def request_json(provider, url, key, payload=None):
    headers = {'Content-Type': 'application/json', 'User-Agent': 'kiku-caption-experiment/1.0'}
    headers['Authorization' if provider == 'groq' else 'x-goog-api-key'] = (
        f'Bearer {key}' if provider == 'groq' else key)
    request = urllib.request.Request(url, headers=headers,
                                    data=json.dumps(payload).encode() if payload is not None else None)
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read())
            code = body.get('error', {}).get('status') or body.get('error', {}).get('code')
        except (ValueError, AttributeError):
            code = None
        try:
            retry_after = float(error.headers.get('retry-after', 0))
        except (ValueError, AttributeError):
            retry_after = None
        # Never echo arbitrary response messages, credential-bearing headers or URLs.
        raise ProviderError(provider, error.code, code, retry_after) from None
    except (urllib.error.URLError, TimeoutError):
        raise ProviderError(provider, 0, 'NETWORK_UNAVAILABLE') from None


def authenticate(provider, key):
    url = ('https://api.groq.com/openai/v1/models' if provider == 'groq' else
           'https://generativelanguage.googleapis.com/v1beta/models')
    result = request_json(provider, url, key)
    return [model.get('id') or model.get('name') for model in result.get('data', result.get('models', []))]


def judge(provider, batch, key, model, prompt, schema):
    text = json.dumps(batch, ensure_ascii=False)
    if provider == 'groq':
        payload = {'model': model, 'messages': [{'role': 'system', 'content': prompt},
                   {'role': 'user', 'content': text}], 'temperature': 0,
                   'reasoning_effort': 'low', 'max_completion_tokens': 4500,
                   'response_format': {'type': 'json_schema', 'json_schema': {
                       'name': 'corrected_subtitles', 'strict': True, 'schema': schema}}}
        result = request_json(provider, 'https://api.groq.com/openai/v1/chat/completions', key, payload)
        choice = result['choices'][0]
        if choice.get('finish_reason') != 'stop':
            raise ValueError('Groq returned an incomplete comparison.')
        output = choice['message']['content']
        usage, response_id = result.get('usage', {}), result.get('id')
    elif provider == 'gemini':
        payload = {'systemInstruction': {'parts': [{'text': prompt}]},
                   'contents': [{'role': 'user', 'parts': [{'text': text}]}],
                   'generationConfig': {'temperature': 0, 'maxOutputTokens': 4500,
                                        'responseMimeType': 'application/json', 'responseJsonSchema': schema}}
        result = request_json(provider,
            f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', key, payload)
        candidate = result.get('candidates', [{}])[0]
        if candidate.get('finishReason') != 'STOP':
            raise ValueError('Gemini returned an incomplete comparison.')
        output = ''.join(part.get('text', '') for part in candidate.get('content', {}).get('parts', [])
                         if not part.get('thought'))
        usage, response_id = result.get('usageMetadata', {}), result.get('responseId')
    else:
        raise ValueError('Unsupported caption comparison provider.')
    return {**json.loads(output), 'model': model, 'responseId': response_id, 'usage': usage}


def throttled_judge(provider, model, prompt, schema, validate):
    """Bounded retries; preserve completed batches and never change billing plans."""
    last_request = [None]

    def call(batch, ignored_model, key):
        if last_request[0] is not None:
            remaining = 25 - (time.monotonic() - last_request[0])
            if remaining > 0:
                time.sleep(remaining)
        for attempt in range(3):
            last_request[0] = time.monotonic()
            try:
                result = judge(provider, batch, key, model, prompt, schema)
                validate(result, batch)
                return result
            except ProviderError as error:
                # A daily quota limit cannot be fixed by a short retry.
                if error.status not in (0, 429, 502, 503, 504) or attempt == 2 or (error.retry_after or 0) > 60:
                    raise
                time.sleep(max(25, error.retry_after or 0))
        raise RuntimeError('Comparison retries exhausted.')
    return call
