import os
import json
import boto3
from botocore.config import Config

_client = None
_embed_client = None

def get_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "bedrock-runtime",
            region_name=os.environ.get("AWS_REGION", "eu-north-1"),
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_KEY"),
            config=Config(
                connect_timeout=10,
                read_timeout=30,
                retries={"max_attempts": 2},
            ),
        )
    return _client

def get_embed_client():
    global _embed_client
    if _embed_client is None:
        _embed_client = boto3.client(
            "bedrock-runtime",
            region_name=os.environ.get("AWS_REGION", "eu-north-1"),
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_KEY"),
        )
    return _embed_client


def converse(system: str, user: str, max_tokens: int = 1024, temperature: float = 0.4) -> str:
    """
    Direct AWS Bedrock Converse API call — same as TypeScript ConverseCommand.
    No LangChain wrapper, no extra dependency, billed purely by AWS token usage.
    """
    model_id = os.environ.get("AI_MODEL", "openai.gpt-oss-20b-1:0")
    response = get_client().converse(
        modelId=model_id,
        system=[{"text": system}],
        messages=[{"role": "user", "content": [{"text": user}]}],
        inferenceConfig={
            "maxTokens": max_tokens,
            "temperature": temperature,
        },
    )
    return response["output"]["message"]["content"][0]["text"]


def embed(text: str) -> list[float]:
    """
    Direct AWS Bedrock Titan embed call — same model as TypeScript VectorStoreService.
    """
    response = get_embed_client().invoke_model(
        modelId="amazon.titan-embed-text-v2:0",
        body=json.dumps({"inputText": text, "dimensions": 1024, "normalize": True}),
        contentType="application/json",
        accept="application/json",
    )
    body = json.loads(response["body"].read())
    return body["embedding"]
