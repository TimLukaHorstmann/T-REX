# backend/models/model_loader.py
from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline
import torch

def load_model(model_name: str):
    """
    Loads the specified Hugging Face model and tokenizer.
    Places the model on GPU if available.
    Returns a text-generation pipeline.
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(device)
    print(model_name)
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.float16,          # Use half-precision to reduce memory usage.
        low_cpu_mem_usage=True,               # Optimizes CPU memory footprint during load.
        device_map="auto"                     # Let transformers decide the best placement.
    )

    generation_pipeline = pipeline(
        "text-generation",
        model=model,
        tokenizer=tokenizer
    )
    return generation_pipeline
