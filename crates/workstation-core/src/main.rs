use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use workstation_core::Engine;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let root = args
        .windows(2)
        .find(|a| a[0] == "--data-dir")
        .map(|a| std::path::PathBuf::from(&a[1]))
        .or_else(|| std::env::var_os("WORKSTATION_DATA_DIR").map(std::path::PathBuf::from));
    let Some(root) = root else {
        eprintln!("Usage: workstation-core --data-dir <directory>");
        std::process::exit(2)
    };
    let engine = match Engine::new(&root) {
        Ok(engine) => engine,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1)
        }
    };
    let mut stdout = io::BufWriter::new(io::stdout());
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let response = match serde_json::from_str::<Value>(&line) {
            Err(error) => {
                json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":error.to_string()}})
            }
            Ok(request) => {
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                if request["jsonrpc"] != "2.0" || !request["method"].is_string() {
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32600,"message":"Invalid JSON-RPC request"}})
                } else {
                    // Notifications do not receive a response, and this control API has no mutating notifications.
                    if request.get("id").is_none() {
                        continue;
                    }
                    match engine.call(
                        request["method"].as_str().unwrap(),
                        request.get("params").cloned().unwrap_or(json!({})),
                    ) {
                        Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
                        Err(error) => {
                            json!({"jsonrpc":"2.0","id":id,"error":{"code":if error.starts_with("METHOD_NOT_FOUND"){-32601}else{-32000},"message":error}})
                        }
                    }
                }
            }
        };
        if writeln!(stdout, "{response}").is_err() || stdout.flush().is_err() {
            break;
        }
    }
}
